import { createClient } from "@/lib/supabase/server";
import OutletsForm from "./outlets-form";

export default async function OutletsPage() {
  const supabase = await createClient();
  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, code, name, is_active, stage")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Outlets</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every location payments are raised from. Requesters pick outlets when submitting.
      </p>

      <div className="mt-8">
        <OutletsForm outlets={outlets ?? []} />
      </div>
    </div>
  );
}
