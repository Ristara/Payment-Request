/**
 * Import the OpEx chart of accounts from a two-column sheet (Category,
 * Account). Transactional and re-runnable: rows in the sheet are inserted or
 * left alone, and OpEx rows NOT in the sheet are retired rather than deleted
 * unless nothing has ever been coded to them.
 *
 * Run: node --env-file=.env.local scripts/import-opex-coa.mjs <file.xlsx> [--dry-run]
 */
import pg from "pg";
import { execFileSync } from "node:child_process";

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) { console.error("usage: import-opex-coa.mjs <file.xlsx> [--dry-run]"); process.exit(1); }

// python3 + openpyxl reads xlsx without pulling an unmaintained npm package in.
const raw = execFileSync("python3", ["-c", `
import openpyxl, json, sys
ws = openpyxl.load_workbook(sys.argv[1], data_only=True).worksheets[0]
out = []
for r in range(2, ws.max_row + 1):
    a, b = ws.cell(r,1).value, ws.cell(r,2).value
    if a and b: out.append([str(a).strip(), str(b).strip()])
print(json.dumps(out))
`, file], { encoding: "utf8" });
const rows = JSON.parse(raw);
console.log(`sheet: ${rows.length} accounts`);

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");

let inserted = 0, kept = 0;
for (const [category, account] of rows) {
  const { rows: found } = await c.query(
    `select id from coa_accounts
      where expense_type='opex' and coa=$1 and category=$1 and subcategory=$2`, [category, account]);
  if (found.length) {
    await c.query("update coa_accounts set is_active=true where id=$1", [found[0].id]);
    kept++;
  } else {
    await c.query(
      `insert into coa_accounts (coa, category, subcategory, expense_type, is_active)
       values ($1, $1, $2, 'opex', true)`, [category, account]);
    inserted++;
  }
}

// Anything OpEx that the sheet no longer lists.
const { rows: stale } = await c.query(`
  select a.id, a.coa, a.subcategory,
         (select count(*) from request_line_items l where l.coa_account_id = a.id)::int used
  from coa_accounts a
  where a.expense_type='opex'
    and not exists (
      select 1 from unnest($1::text[], $2::text[]) as s(cat, acct)
      where a.coa = s.cat and a.subcategory = s.acct)`,
  [rows.map(r => r[0]), rows.map(r => r[1])]);
let retired = 0, deleted = 0;
for (const s of stale) {
  if (s.used > 0) { await c.query("update coa_accounts set is_active=false where id=$1", [s.id]); retired++; }
  else { await c.query("delete from coa_accounts where id=$1", [s.id]); deleted++; }
}

console.log(`inserted ${inserted}, already present ${kept}, retired ${retired}, removed ${deleted}`);
const { rows: [tot] } = await c.query(
  "select count(*)::int n, count(distinct coa)::int cats from coa_accounts where expense_type='opex' and is_active");
console.log(`OpEx chart now: ${tot.n} accounts across ${tot.cats} categories`);

await c.query(dry ? "rollback" : "commit");
console.log(dry ? "DRY RUN — rolled back" : "committed");
await c.end();
