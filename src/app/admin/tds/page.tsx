import { createClient } from "@/lib/supabase/server";
import TdsSectionsForm from "./tds-sections-form";

export default async function TdsSectionsPage() {
  const supabase = await createClient();

  const [{ data: sections }, { data: used }] = await Promise.all([
    supabase
      .from("tds_sections")
      .select("id, code, name, rate, is_active, statutory_ref, guidance")
      .order("code"),
    // How many deductions each section carries — shown on the row so an admin
    // can see what turning one off would affect, and why some can't be deleted.
    supabase
      .from("request_installments")
      .select("tds_section_id")
      .not("tds_section_id", "is", null),
  ]);

  const counts: Record<string, number> = {};
  for (const r of (used ?? []) as { tds_section_id: string }[]) {
    counts[r.tds_section_id] = (counts[r.tds_section_id] ?? 0) + 1;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">TDS sections</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The list Accounts picks from when deducting TDS. Anything you turn off
        disappears from that dropdown but stays on the payments already using it.
      </p>

      <div className="mt-8">
        <TdsSectionsForm sections={sections ?? []} counts={counts} />
      </div>
    </div>
  );
}
