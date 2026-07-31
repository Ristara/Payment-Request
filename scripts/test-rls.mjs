/**
 * RLS behaviour tests. Impersonates real users inside a transaction that is
 * always rolled back, so it is safe to run against production.
 *
 * Run: node --env-file=.env.local scripts/test-rls.mjs
 */
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const uid = async (email) =>
  (await c.query("select id from auth.users where email=$1", [email])).rows[0].id;

const ANIKETH = await uid("aniketh@ristarafoods.com");   // no roles
const GOV = await uid("govardhan@ristarafoods.com");     // requester only

async function as(userId, sql, params = []) {
  await c.query("begin");
  try {
    await c.query("set local role authenticated");
    await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: "authenticated" })}'`);
    const res = await c.query(sql, params);
    await c.query("rollback");
    return res.rowCount > 0 ? "ALLOWED" : "BLOCKED (no rows matched)";
  } catch (e) {
    await c.query("rollback");
    return `BLOCKED (${e.message.split("\n")[0].slice(0, 60)})`;
  }
}

const VENDOR = (await c.query("select id from vendors limit 1")).rows[0].id;
const results = [];

results.push(["roleless user inserts a payment request", "BLOCKED", await as(ANIKETH,
  `insert into payment_requests (request_number, submitter_id, vendor_id, title, payment_kind, document_type, document_reference, purpose)
   values ('PR-TEST-1', $1, $2, 't', 'regular', 'po', 'PO-1', 'test')`, [ANIKETH, VENDOR])]);

results.push(["requester inserts a payment request", "ALLOWED", await as(GOV,
  `insert into payment_requests (request_number, submitter_id, vendor_id, title, payment_kind, document_type, document_reference, purpose)
   values ('PR-TEST-2', $1, $2, 't', 'regular', 'po', 'PO-1', 'test')`, [GOV, VENDOR])]);

results.push(["requester creates an APPROVED vendor", "BLOCKED", await as(GOV,
  `insert into vendors (name, pan, submitted_by, status) values ('Test Co', 'AAAAA0000A', $1, 'approved')`, [GOV])]);

results.push(["requester creates a pending vendor", "ALLOWED", await as(GOV,
  `insert into vendors (name, pan, submitted_by, status) values ('Test Co', 'AAAAA0000A', $1, 'pending')`, [GOV])]);

// Approving your own installment, the way the old policy allowed.
const own = (await c.query(
  `select i.id, i.request_id from request_installments i
   join payment_requests r on r.id = i.request_id
   where r.submitter_id = $1 and i.status = 'pending_approval' limit 1`, [ANIKETH])).rows[0];
if (own) {
  results.push(["submitter approves their OWN installment", "BLOCKED", await as(ANIKETH,
    `update request_installments set status='approved' where id=$1`, [own.id])]);
  // Still awaiting approval — the submitter is meant to be able to fix it.
  results.push(["submitter edits their thread PRE-approval", "ALLOWED", await as(ANIKETH,
    `update payment_requests set title='edited' where id=$1`, [own.request_id])]);
  results.push(["submitter recalls their own pending request", "ALLOWED", await as(ANIKETH,
    `update request_installments set status='draft' where id=$1`, [own.id])]);
  results.push(["submitter rewrites line items behind it", "ALLOWED", await as(ANIKETH,
    `update request_line_items set quantity=quantity where request_id=$1`, [own.request_id])]);
}

// The one that matters: repointing the payee after the money is in motion.
const locked = (await c.query(
  `select i.request_id from request_installments i
   join payment_requests r on r.id = i.request_id
   where r.submitter_id = $1
     and i.status = any (array['approved','uploaded_in_bank','payment_processed','invoice_pending','closed']::request_status[])
   limit 1`, [ANIKETH])).rows[0];
if (locked) {
  results.push(["submitter repoints the payee POST-approval", "BLOCKED", await as(ANIKETH,
    `update payment_requests set vendor_id=$1 where id=$2`, [VENDOR, locked.request_id])]);
  results.push(["submitter rewrites line items POST-approval", "BLOCKED", await as(ANIKETH,
    `update request_line_items set quantity=quantity+1 where request_id=$1`, [locked.request_id])]);
}

results.push(["user switches their own account back on", "BLOCKED", await as(ANIKETH,
  `update profiles set is_active=true where id=$1`, [ANIKETH])]);

results.push(["user edits their own name", "ALLOWED", await as(ANIKETH,
  `update profiles set full_name='Aniketh K V' where id=$1`, [ANIKETH])]);

let bad = 0;
for (const [name, want, got] of results) {
  const ok = got.startsWith(want);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  want ${want.padEnd(7)} · ${name}\n        got ${got}`);
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
await c.end();
process.exit(bad ? 1 : 0);
