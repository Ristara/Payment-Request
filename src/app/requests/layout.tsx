import AppShell from "@/lib/appLayout";
export default async function RequestsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
