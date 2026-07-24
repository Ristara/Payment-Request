import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import AppLayoutShell from "@/lib/appLayout";
import { formatISTDate, shortRequestNumber } from "@/lib/types";

type ResultRow = {
  id: string;
  request_number: string;
  title: string | null;
  created_at: string;
  vendor: { name: string } | null;
};

/**
 * Global search, fed by the top-bar box. Matches request number (with or
 * without the year), title, vendor name, and UTR reference. RLS scopes the
 * results — submitters only see their own / CC'd threads.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const { q = "" } = await searchParams;
  const query = q.trim();
  const supabase = await createClient();

  let rows: ResultRow[] = [];
  if (query.length >= 2) {
    // ilike patterns treat % _ , ( ) specially — flatten them to spaces.
    const safe = query.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
    // "PR-00134" / "PR-2026-00134" / "00134" should all hit PR-2026-00134.
    const digits = safe.replace(/^pr-?/i, "").replace(/^\d{4}-/, "");
    const orParts = [`request_number.ilike.%${safe}%`, `title.ilike.%${safe}%`];
    if (digits && digits !== safe) orParts.push(`request_number.ilike.%${digits}%`);

    const [byThread, byVendor, byUtr] = await Promise.all([
      supabase.from("payment_requests").select("id").or(orParts.join(",")).limit(40),
      supabase.from("vendors").select("id").ilike("name", `%${safe}%`).limit(20),
      supabase
        .from("payment_records")
        .select("installment:request_installments(request_id)")
        .ilike("utr_reference", `%${safe}%`)
        .limit(20),
    ]);

    const vendorIds = ((byVendor.data ?? []) as { id: string }[]).map((v) => v.id);
    const byVendorThreads = vendorIds.length
      ? await supabase.from("payment_requests").select("id").in("vendor_id", vendorIds).limit(40)
      : { data: [] as { id: string }[] };

    const ids = new Set<string>();
    ((byThread.data ?? []) as { id: string }[]).forEach((r) => ids.add(r.id));
    ((byVendorThreads.data ?? []) as { id: string }[]).forEach((r) => ids.add(r.id));
    type UtrRow = { installment: { request_id: string } | { request_id: string }[] | null };
    ((byUtr.data ?? []) as unknown as UtrRow[]).forEach((r) => {
      const inst = Array.isArray(r.installment) ? r.installment[0] : r.installment;
      if (inst?.request_id) ids.add(inst.request_id);
    });

    if (ids.size > 0) {
      const { data } = await supabase
        .from("payment_requests")
        .select("id, request_number, title, created_at, vendor:vendors(name)")
        .in("id", [...ids])
        .order("created_at", { ascending: false })
        .limit(50);
      rows = (data ?? []) as unknown as ResultRow[];
    }
  }

  return (
    <AppLayoutShell pageTitle="Search">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
          Search
        </h1>

        {/* Works on mobile too, where the top-bar box is hidden. */}
        <form action="/search" className="mt-4">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Request # / title / vendor / UTR…"
            autoFocus
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>

        {query.length < 2 ? (
          <p className="mt-6 text-sm text-zinc-500">
            Type at least 2 characters and press Enter.
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">
            No matches for &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <>
            <p className="mt-6 text-xs text-zinc-500">
              {rows.length} match{rows.length === 1 ? "" : "es"}
            </p>
            <ul className="mt-2 space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-indigo-950/20"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {shortRequestNumber(r.request_number)}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">{formatISTDate(r.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {r.title || r.vendor?.name}
                    </p>
                    {r.title && (
                      <p className="truncate text-xs text-zinc-500">{r.vendor?.name}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AppLayoutShell>
  );
}
