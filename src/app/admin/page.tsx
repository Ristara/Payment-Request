import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

async function counts() {
  const supabase = await createClient();
  const [users, outlets, cats, subs, coa] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("outlets").select("*", { count: "exact", head: true }),
    supabase.from("expense_categories").select("*", { count: "exact", head: true }),
    supabase.from("expense_subcategories").select("*", { count: "exact", head: true }),
    supabase.from("coa_heads").select("*", { count: "exact", head: true }),
  ]);
  return {
    users: users.count ?? 0,
    outlets: outlets.count ?? 0,
    categories: cats.count ?? 0,
    subcategories: subs.count ?? 0,
    coa: coa.count ?? 0,
  };
}

export default async function AdminHome() {
  const c = await counts();

  const tiles = [
    { href: "/admin/users", label: "Users", value: c.users, hint: "invite people + assign roles" },
    { href: "/admin/outlets", label: "Outlets", value: c.outlets, hint: "branches / locations" },
    { href: "/admin/categories", label: "Categories", value: c.categories, hint: "top-level spend groups" },
    { href: "/admin/categories", label: "Subcategories", value: c.subcategories, hint: "linked to a COA head" },
    { href: "/admin/coa", label: "COA heads", value: c.coa, hint: "ledger accounts for reporting" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Admin
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Manage users, roles, and the master data that drives the app.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-2xl border border-zinc-200 bg-white p-5 hover:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t.label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
              {t.value}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{t.hint}</p>
          </Link>
        ))}
      </section>

      <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          Setup checklist
        </h2>
        <ol className="mt-3 space-y-1 text-sm text-amber-900 dark:text-amber-100">
          <li>1. Add every outlet your team pays from.</li>
          <li>2. Add COA heads first (e.g. &quot;Repairs &amp; Maintenance&quot;, &quot;IT Software Expense&quot;).</li>
          <li>3. Add categories (e.g. &quot;Civil&quot;, &quot;IT&quot;) then subcategories under each, each linked to a COA head.</li>
          <li>4. Invite users and assign roles (Approver, Accounts).</li>
        </ol>
      </div>
    </div>
  );
}
