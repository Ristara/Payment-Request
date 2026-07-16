import { redirect } from "next/navigation";
import AppShell from "@/lib/appLayout";
import { getCurrentUserRoles } from "@/lib/auth";
import Link from "next/link";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { roles } = await getCurrentUserRoles();
  if (!roles.some((r) => ["approver", "accounts", "admin"].includes(r))) redirect("/dashboard");

  return (
    <AppShell>
      <div className="mb-6 flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {[
          { href: "/reports", label: "Spend" },
          { href: "/reports/invoice-pending", label: "Invoice pending" },
          { href: "/reports/cashflow", label: "Cash-flow due" },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:border-indigo-600 hover:text-indigo-700 dark:text-zinc-400 dark:hover:text-indigo-300"
          >
            {t.label}
          </Link>
        ))}
      </div>
      {children}
    </AppShell>
  );
}
