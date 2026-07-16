import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("admin")) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader
        links={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/admin", label: "Admin" },
          { href: "/admin/users", label: "Users" },
          { href: "/admin/outlets", label: "Outlets" },
          { href: "/admin/categories", label: "Categories" },
          { href: "/admin/coa", label: "COA" },
        ]}
        showAdmin
      />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
