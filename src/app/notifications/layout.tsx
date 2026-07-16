import AppShell from "@/lib/appLayout";
export default async function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
