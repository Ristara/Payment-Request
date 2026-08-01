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

check("user: switch their own account back on", "BLOCKED", await as(NOBODY,
  "update public.profiles set is_active=true where id=$1", [NOBODY]));
check("user: edit their own name", "ALLOWED", await as(NOBODY,
  "update public.profiles set full_name='x' where id=$1", [NOBODY]));

// --- Report ---------------------------------------------------------------
await c.query("rollback");
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
