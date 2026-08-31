import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ReportActions from "./report-actions";

type SavedRow = {
  id: string;
  name: string;
  config: {
    rows?: string[];
    cols?: string[];
    filters?: string[];
    from?: string;
    to?: string;
  };
  updated_at: string;
};

const FIELD_LABEL: Record<string, string> = {
  coa: "Category",
  category: "Sub category",
  account: "Account",
  outlet: "Outlet",
  vendor: "Vendor",
  expense: "Expense type",
  stage: "New / existing",
  kind: "Payment kind",
  status: "Status",
  raisedBy: "Raised by",
  month: "Month",
};

export default async function FavouriteReportsPage() {
  const supabase = await createClient();
  // RLS returns only this person's — a saved layout is a working note, not a
  // company artefact, so nobody else's clutters the list.
  const { data } = await supabase
    .from("saved_reports")
    .select("id, name, config, updated_at")
    .order("name");
  const saved = (data ?? []) as SavedRow[];

  const summarise = (c: SavedRow["config"]) => {
    const bits: string[] = [];
    const names = (keys?: string[]) => (keys ?? []).map((k) => FIELD_LABEL[k] ?? k).join(", ");
    if (c.rows?.length) bits.push(`Rows: ${names(c.rows)}`);
    if (c.cols?.length) bits.push(`Columns: ${names(c.cols)}`);
    if (c.filters?.length) bits.push(`Filtered by ${names(c.filters)}`);
    if (c.from || c.to) bits.push(`${c.from || "start"} → ${c.to || "today"}`);
    return bits.join(" · ");
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Favourite reports
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Layouts you&rsquo;ve saved. Opening one rebuilds it against today&rsquo;s data.
          </p>
        </div>
        <Link
          href="/reports/create"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create report
        </Link>
      </div>

      {saved.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Nothing saved yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Build a report, then save it with a name and it will appear here.
          </p>
          <Link
            href="/reports/create"
            className="mt-4 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Create your first report
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {saved.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="min-w-0">
                <Link
                  href={`/reports/create?saved=${r.id}`}
                  className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {r.name}
                </Link>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{summarise(r.config)}</p>
              </div>
              <ReportActions id={r.id} name={r.name} />
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
