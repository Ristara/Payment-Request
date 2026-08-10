/**
 * RLS behaviour tests.
 *
 * Everything runs inside ONE transaction that is always rolled back, so this
 * is safe to run against production. Each assertion gets a savepoint.
 *
 * The users, vendors and requests are created by the test itself rather than
 * picked out of live data. An earlier version selected real people by email
 * and started asserting the wrong thing the moment someone's roles were
 * changed in the admin console — a security test that quietly changes meaning
 * is worse than no test at all.
 *
 * Run: node --env-file=.env.local scripts/test-rls.mjs
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
// Belt and braces. Everything below runs inside one transaction that is rolled
// back, so nothing should ever persist — but a block accidentally placed AFTER
// the rollback commits for real, and six test users once ended up in the live
// user list that way. This sweeps any survivors from a previous run before
// starting, and runs again at the end.
async function sweepTestUsers() {
  await c.query("delete from auth.users where email like 'rlstest%'");
}
await sweepTestUsers();

await c.query("begin");

const results = [];
const check = (name, want, got) => results.push([name, want, got]);

/** Run a statement as a given user, then undo it. */
async function as(userId, sql, params = []) {
  await c.query("savepoint sp");
  try {
    await c.query("set local role authenticated");
    await c.query(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: "authenticated" })}'`,
    );
    const res = await c.query(sql, params);
    await c.query("rollback to savepoint sp");
    await c.query("reset role");
    // An UPDATE that matches no row raises nothing. That is not permission.
    return res.rowCount > 0 ? "ALLOWED" : "BLOCKED (no rows matched)";
  } catch (e) {
    await c.query("rollback to savepoint sp");
    await c.query("reset role");
    return `BLOCKED (${e.message.split("\n")[0].slice(0, 58)})`;
  }
}

// --- Fixtures -------------------------------------------------------------
async function makeUser(label, roles) {
  const id = randomUUID();
  await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now())`,
    [id, `rlstest-${label}-${id.slice(0, 8)}@ristarafoods.com`],
  );
  // A trigger may already have made the profile row; make sure one exists.
  await c.query(
    `insert into public.profiles (id, email, full_name, is_active)
     values ($1, $2, $3, true)
     on conflict (id) do update set is_active = true`,
    [id, `rlstest-${label}@ristarafoods.com`, `RLS Test ${label}`],
  );
  for (const r of roles) {
    await c.query("insert into public.user_roles (user_id, role) values ($1, $2)", [id, r]);
  }
  return id;
}

const NOBODY = await makeUser("nobody", []);
const REQUESTER = await makeUser("requester", ["requester"]);
const ACCOUNTS = await makeUser("accounts", ["accounts"]);

const vendorApproved = randomUUID();
await c.query(
  `insert into public.vendors (id, name, pan, status, submitted_by)
   values ($1, 'RLS Test Vendor', 'AAAAA0000A', 'approved', $2)`,
  [vendorApproved, ACCOUNTS],
);
const vendorOwnPending = randomUUID();
await c.query(
  `insert into public.vendors (id, name, pan, status, submitted_by)
   values ($1, 'RLS Test Pending', 'BBBBB0000B', 'pending', $2)`,
  [vendorOwnPending, REQUESTER],
);

/** A thread owned by REQUESTER whose single installment sits at `status`. */
async function makeThread(status) {
  const rid = randomUUID();
  await c.query(
    `insert into public.payment_requests
       (id, request_number, submitter_id, vendor_id, title, purpose, payment_kind,
        document_type, document_reference)
     values ($1, $2, $3, $4, 'RLS test', 'test', 'regular', 'po', 'PO-RLS')`,
    [rid, `PR-RLS-${rid.slice(0, 8)}`, REQUESTER, vendorApproved],
  );
  await c.query(
    `insert into public.request_installments
       (request_id, installment_number, requested_amount, payment_due_date, status, submitted_by)
     values ($1, 1, 1000, current_date, $2, $3)`,
    [rid, status, REQUESTER],
  );
  await c.query(
    `insert into public.request_line_items (request_id, coa_account_id, quantity, rate)
     select $1, id, 1, 1000 from public.coa_accounts where is_active limit 1`,
    [rid],
  );
  const inst = (
    await c.query("select id from public.request_installments where request_id = $1", [rid])
  ).rows[0].id;
  return { rid, inst };
}

// Raising now needs branch + expense grants, so the base requester gets them.
await c.query(
  `insert into user_branch_access (user_id, outlet_id)
   select $1, id from outlets where is_active`, [REQUESTER]);
await c.query("insert into user_expense_access (user_id, expense_type) values ($1,'capex'),($1,'opex')", [REQUESTER]);

const pending = await makeThread("pending_approval");
const approved = await makeThread("approved");

// --- Assertions -----------------------------------------------------------
const newRequest = `insert into public.payment_requests
  (request_number, submitter_id, vendor_id, title, purpose, payment_kind, document_type, document_reference)
  values ('PR-RLS-X', $1, $2, 't', 'test', 'regular', 'po', 'PO-1')`;

check("no roles: raise a payment request", "BLOCKED",
  await as(NOBODY, newRequest, [NOBODY, vendorApproved]));
check("requester: raise a payment request", "ALLOWED",
  await as(REQUESTER, newRequest, [REQUESTER, vendorApproved]));

check("requester: create an APPROVED vendor", "BLOCKED", await as(REQUESTER,
  `insert into public.vendors (name, pan, submitted_by, status)
   values ('X', 'CCCCC0000C', $1, 'approved')`, [REQUESTER]));
check("requester: create a pending vendor", "ALLOWED", await as(REQUESTER,
  `insert into public.vendors (name, pan, submitted_by, status)
   values ('X', 'CCCCC0000C', $1, 'pending')`, [REQUESTER]));

check("submitter: approve their OWN installment", "BLOCKED", await as(REQUESTER,
  "update public.request_installments set status='approved' where id=$1", [pending.inst]));
check("submitter: recall their own pending request", "ALLOWED", await as(REQUESTER,
  "update public.request_installments set status='draft' where id=$1", [pending.inst]));

check("submitter: edit the thread PRE-approval", "ALLOWED", await as(REQUESTER,
  "update public.payment_requests set title='edited' where id=$1", [pending.rid]));
check("submitter: repoint the payee POST-approval", "BLOCKED", await as(REQUESTER,
  "update public.payment_requests set vendor_id=$1 where id=$2", [vendorOwnPending, approved.rid]));
check("submitter: rewrite line items POST-approval", "BLOCKED", await as(REQUESTER,
  "update public.request_line_items set rate=99999 where request_id=$1", [approved.rid]));

check("requester: read an approved vendor", "ALLOWED", await as(REQUESTER,
  "select id from public.vendors where id=$1", [vendorApproved]));
check("requester: edit an APPROVED vendor", "BLOCKED", await as(REQUESTER,
  "update public.vendors set bank_account_number='9' where id=$1", [vendorApproved]));
// Blocked at the database on purpose. The app still lets a submitter correct
// their own not-yet-verified vendor, but it does that through the service-role
// client after checking in TypeScript — so nobody can do it by hand.
check("requester: edit their own pending vendor directly", "BLOCKED", await as(REQUESTER,
  "update public.vendors set bank_account_number='9' where id=$1", [vendorOwnPending]));
check("accounts: edit an approved vendor", "ALLOWED", await as(ACCOUNTS,
  "update public.vendors set bank_account_number='9' where id=$1", [vendorApproved]));

// --- CC'd (watcher) access ------------------------------------------------
const WATCHER = await makeUser("watcher", ["requester"]);
const OUTSIDER = await makeUser("outsider", ["requester"]);
await c.query("insert into public.request_watchers (request_id, user_id) values ($1,$2)",
  [approved.rid, WATCHER]);
// The timeline check needs something on the timeline, or "0 rows" reads as
// a denial when it just means the fixture was empty.
await c.query(
  `insert into public.status_history (request_id, installment_id, actor_id, from_status, to_status, comment)
   values ($1, $2, $3, 'pending_approval', 'approved', 'fixture')`,
  [approved.rid, approved.inst, REQUESTER]);

check("CC'd: read the thread", "ALLOWED", await as(WATCHER,
  "select id from public.payment_requests where id=$1", [approved.rid]));
check("CC'd: read its INSTALLMENTS (the status)", "ALLOWED", await as(WATCHER,
  "select id from public.request_installments where request_id=$1", [approved.rid]));
check("CC'd: read its line items", "ALLOWED", await as(WATCHER,
  "select id from public.request_line_items where request_id=$1", [approved.rid]));
check("CC'd: read its timeline", "ALLOWED", await as(WATCHER,
  "select id from public.status_history where request_id=$1", [approved.rid]));
check("CC'd: raise the next installment", "ALLOWED", await as(WATCHER,
  `insert into public.request_installments
     (request_id, installment_number, requested_amount, payment_due_date, status, submitted_by)
   values ($1, 9, 1, current_date, 'pending_approval', $2)`, [approved.rid, WATCHER]));
check("CC'd: approve it themselves", "BLOCKED", await as(WATCHER,
  "update public.request_installments set status='approved' where id=$1", [approved.inst]));

check("not CC'd: read the thread", "BLOCKED", await as(OUTSIDER,
  "select id from public.payment_requests where id=$1", [approved.rid]));
check("not CC'd: read its installments", "BLOCKED", await as(OUTSIDER,
  "select id from public.request_installments where request_id=$1", [approved.rid]));
check("not CC'd: raise an installment on it", "BLOCKED", await as(OUTSIDER,
  `insert into public.request_installments
     (request_id, installment_number, requested_amount, payment_due_date, status, submitted_by)
   values ($1, 8, 1, current_date, 'pending_approval', $2)`, [approved.rid, OUTSIDER]));

// --- Branch + expense-type access (governs raising only) ------------------
const GRANTED = await makeUser("granted", ["requester"]);
const UNGRANTED = await makeUser("ungranted", ["requester"]);
const { rows: [o1] } = await c.query("select id from outlets where is_active limit 1");
const { rows: [o2] } = await c.query("select id from outlets where is_active offset 1 limit 1");
await c.query("insert into user_branch_access (user_id, outlet_id) values ($1,$2)", [GRANTED, o1.id]);
await c.query("insert into user_expense_access (user_id, expense_type) values ($1,'capex')", [GRANTED]);

const newReq = (etype) => `insert into public.payment_requests
  (request_number, submitter_id, vendor_id, title, purpose, payment_kind,
   document_type, document_reference, expense_type)
  values ('PR-ACC-' || substr(md5(random()::text),1,6), $1, $2, 't', 'p', 'regular', 'po', 'PO-1', '${etype}')`;

check("no branches granted: raise at all", "BLOCKED",
  await as(UNGRANTED, newReq("capex"), [UNGRANTED, vendorApproved]));
check("granted CapEx: raise CapEx", "ALLOWED",
  await as(GRANTED, newReq("capex"), [GRANTED, vendorApproved]));
check("granted CapEx only: raise OpEx", "BLOCKED",
  await as(GRANTED, newReq("opex"), [GRANTED, vendorApproved]));

// Migration 033: approver and accounts raise anywhere without a grant. They
// already approve and pay every branch, so requiring a grant to *ask* for what
// they can already authorise protected nothing. These four assertions are the
// whole of that rule — if one starts failing, the SQL and
// UNRESTRICTED_RAISE_ROLES in src/lib/access-labels.ts have drifted apart.
const APPROVER_NG = await makeUser("approver-nogrants", ["requester", "approver"]);
const ACCOUNTS_NG = await makeUser("accounts-nogrants", ["requester", "accounts"]);
check("approver, no branches granted: raise CapEx", "ALLOWED",
  await as(APPROVER_NG, newReq("capex"), [APPROVER_NG, vendorApproved]));
check("approver, no expense granted: raise OpEx", "ALLOWED",
  await as(APPROVER_NG, newReq("opex"), [APPROVER_NG, vendorApproved]));
check("accounts, no branches granted: raise OpEx", "ALLOWED",
  await as(ACCOUNTS_NG, newReq("opex"), [ACCOUNTS_NG, vendorApproved]));

// The widening is per-role, not a hole: a plain requester is unaffected.
check("plain requester still needs a grant", "BLOCKED",
  await as(UNGRANTED, newReq("opex"), [UNGRANTED, vendorApproved]));

// An approver may now raise against any branch — but still may not attach one
// to a request and then sign it off. That guard lives in approveInstallment.

// The branch itself is checked on the join row.
const { rows: [pr] } = await c.query(
  `insert into public.payment_requests
     (request_number, submitter_id, vendor_id, title, purpose, payment_kind, document_type, document_reference, expense_type)
   values ('PR-ACC-J', $1, $2, 't','p','regular','po','PO-1','capex') returning id`,
  [GRANTED, vendorApproved]);
check("granted branch: attach that branch", "ALLOWED", await as(GRANTED,
  "insert into request_outlets (request_id, outlet_id) values ($1,$2)", [pr.id, o1.id]));
check("ungranted branch: attach it anyway", "BLOCKED", await as(GRANTED,
  "insert into request_outlets (request_id, outlet_id) values ($1,$2)", [pr.id, o2.id]));

// Access governs raising, not sight: GRANTED raised PR-ACC-J against a
// branch; revoking the grant must not hide it from them.
await c.query("delete from user_branch_access where user_id=$1", [GRANTED]);
check("grants revoked: still sees own request", "ALLOWED", await as(GRANTED,
  "select id from public.payment_requests where id=$1", [pr.id]));
check("grants revoked: can no longer raise", "BLOCKED",
  await as(GRANTED, newReq("capex"), [GRANTED, vendorApproved]));

check("user: switch their own account back on", "BLOCKED", await as(NOBODY,
  "update public.profiles set is_active=true where id=$1", [NOBODY]));
check("user: edit their own name", "ALLOWED", await as(NOBODY,
  "update public.profiles set full_name='x' where id=$1", [NOBODY]));

// --- Report ---------------------------------------------------------------
// --- Procurement requests (migration 036) ---------------------------------
{
  const { rows: [o1] } = await c.query("select id from outlets where is_active limit 1");
  const { rows: [o2] } = await c.query("select id from outlets where is_active offset 1 limit 1");
  const PROC_OK = await makeUser("proc-granted", ["requester"]);
  const PROC_NO = await makeUser("proc-nogrant", ["requester"]);
  // No procurement role any more: whoever raises a request records its PO.
  // This user stands in for "some other requester" — they must not see or
  // touch a request that is not theirs.
  const PROC_TEAM = await makeUser("proc-other", ["requester"]);
  await c.query("insert into user_branch_access (user_id, outlet_id) values ($1,$2)", [PROC_OK, o1.id]);

  const newProc = (outlet) => [`insert into public.procurement_requests
      (request_number, submitter_id, title, description, outlet_id)
     values ('PRQ-T-' || substr(md5(random()::text),1,6), $1, 't', 'd', '${outlet}')`];

  check("procurement: raise for a granted branch", "ALLOWED",
    await as(PROC_OK, newProc(o1.id)[0], [PROC_OK]));
  check("procurement: raise for an UNgranted branch", "BLOCKED",
    await as(PROC_OK, newProc(o2.id)[0], [PROC_OK]));
  check("procurement: no branches granted, raise at all", "BLOCKED",
    await as(PROC_NO, newProc(o1.id)[0], [PROC_NO]));
  check("procurement: another requester with no branch cannot raise", "BLOCKED",
    await as(PROC_TEAM, newProc(o1.id)[0], [PROC_TEAM]));
  check("procurement: cannot raise as someone else", "BLOCKED",
    await as(PROC_OK, `insert into public.procurement_requests
      (request_number, submitter_id, title, description, outlet_id)
      values ('PRQ-T-spoof', $1, 't', 'd', $2)`, [PROC_NO, o1.id]));

  // The table has no UPDATE policy on purpose — every transition goes through
  // a server action under the service-role client. If a policy is ever added
  // carelessly, this is what catches it.
  const { rows: [mine] } = await c.query(
    `insert into public.procurement_requests
       (request_number, submitter_id, title, description, outlet_id)
     values ('PRQ-T-own', $1, 't', 'd', $2) returning id`, [PROC_OK, o1.id]);
  check("procurement: submitter cannot approve their own row directly", "BLOCKED",
    await as(PROC_OK, "update public.procurement_requests set status='approved' where id=$1", [mine.id]));
  check("procurement: another requester cannot approve someone else's row", "BLOCKED",
    await as(PROC_TEAM, "update public.procurement_requests set status='approved' where id=$1", [mine.id]));
  check("procurement: submitter still SEES their own", "ALLOWED",
    await as(PROC_OK, "select 1 from public.procurement_requests where id=$1", [mine.id]));
  check("procurement: an unrelated requester cannot see it", "BLOCKED",
    await as(PROC_NO, "select 1 from public.procurement_requests where id=$1 having count(*)>0", [mine.id]));

  // CC must actually GRANT access. On the payment side this was broken for a
  // while: the notification arrived and the page refused to load, with no
  // error to explain it. Asserted here so it cannot happen again.
  await c.query(
    "insert into procurement_watchers (procurement_request_id, user_id, added_by) values ($1,$2,$3)",
    [mine.id, PROC_TEAM, PROC_OK]);
  check("procurement: a CC'd person CAN see it", "ALLOWED",
    await as(PROC_TEAM, "select 1 from public.procurement_requests where id=$1", [mine.id]));
  check("procurement: being CC'd does not let them approve it", "BLOCKED",
    await as(PROC_TEAM, "update public.procurement_requests set status='approved' where id=$1", [mine.id]));
  check("procurement: a CC'd person cannot CC others", "BLOCKED",
    await as(PROC_TEAM, `insert into procurement_watchers (procurement_request_id, user_id)
       values ($1, $2)`, [mine.id, PROC_NO]));
}

// --- TDS sections (admin-managed master) -----------------------------------
// The dropdown Accounts picks from. Everyone signed in reads it; only an admin
// may change it. Accounts is the interesting case: they are the ones USING the
// list, and the obvious mistake is letting the consumer of a master table edit
// it.
{
  const ADMIN = await makeUser("tdsadmin", ["admin"]);
  const secId = randomUUID();
  await c.query(
    "insert into public.tds_sections (id, code, name, rate) values ($1,'194ZZ','RLS Test section', 5)",
    [secId],
  );

  check("tds: accounts can read the list", "ALLOWED",
    await as(ACCOUNTS, "select 1 from public.tds_sections where id=$1", [secId]));
  check("tds: a plain requester can read the list", "ALLOWED",
    await as(REQUESTER, "select 1 from public.tds_sections where id=$1", [secId]));

  check("tds: accounts cannot add a section", "BLOCKED",
    await as(ACCOUNTS, "insert into public.tds_sections (code, name) values ('194YY','nope')"));
  check("tds: accounts cannot change the rate", "BLOCKED",
    await as(ACCOUNTS, "update public.tds_sections set rate=99 where id=$1", [secId]));
  check("tds: accounts cannot delete a section", "BLOCKED",
    await as(ACCOUNTS, "delete from public.tds_sections where id=$1", [secId]));
  check("tds: a plain requester cannot add one", "BLOCKED",
    await as(REQUESTER, "insert into public.tds_sections (code, name) values ('194XX','nope')"));

  check("tds: an admin can add a section", "ALLOWED",
    await as(ADMIN, "insert into public.tds_sections (code, name, rate) values ('194WW','ok', 2)"));
  check("tds: an admin can turn one off", "ALLOWED",
    await as(ADMIN, "update public.tds_sections set is_active=false where id=$1", [secId]));

  // Two rows claiming to be 194C is how a picker starts lying about which one
  // was chosen.
  check("tds: duplicate section codes are refused", "BLOCKED",
    await as(ADMIN, "insert into public.tds_sections (code, name) values ('194ZZ','duplicate')"));
  check("tds: a rate above 100% is refused", "BLOCKED",
    await as(ADMIN, "insert into public.tds_sections (code, name, rate) values ('194VV','bad', 150)"));
}

await c.query("rollback");
// Nothing should be left, but if a future edit strays past the rollback this
// is what stops it reaching the user list.
await sweepTestUsers();

// --- Ria's scoping is a source-level invariant, not an RLS one -------------
//
// Every assistant lookup goes through the USER'S client, which is the only
// reason Ria cannot tell one person about another's payments. Swapping in the
// service-role client would bypass RLS and let her answer anything to anyone,
// with no error and nothing visible in the UI. It is the kind of change that
// looks like a bug fix at 11pm.
//
// This lives above the grading loop deliberately. Placed below it, the result
// was counted but never graded — a test that inflates the total and can never
// fail, which is worse than no test at all. It was written that way first,
// and only caught because the guard was checked against a planted regression.
{
  const fs = await import("node:fs");
  const files = [
    "src/lib/assistant/tools.ts",
    "src/app/api/assistant/tool/route.ts",
    "src/app/api/assistant/route.ts",
  ];
  const leaky = files.filter((f) =>
    /createAdminClient|SERVICE_ROLE|SUPABASE_SECRET/.test(fs.readFileSync(f, "utf8")),
  );
  check(
    "assistant never uses the service-role client",
    "ALLOWED",
    leaky.length === 0 ? "ALLOWED" : `BLOCKED · bypasses RLS: ${leaky.join(", ")}`,
  );
}

await c.end();

let bad = 0;
for (const [name, want, got] of results) {
  const ok = got.startsWith(want);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  want ${want.padEnd(7)} · ${name}`);
  if (!ok) console.log(`        got  ${got}`);
}

console.log(bad ? `\n${bad} FAILED` : `\nall ${results.length} passed`);
process.exit(bad ? 1 : 0);
