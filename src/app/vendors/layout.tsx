import AppShell from "@/lib/appLayout";

export default async function VendorsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
