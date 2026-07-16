import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { markAllNotificationsRead, markNotificationRead } from "@/app/requests/actions";

type Row = {
  id: string;
  kind: string;
  body: string;
  read_at: string | null;
  request_id: string | null;
  vendor_id: string | null;
  created_at: string;
  actor: { full_name: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  mentioned: "You were mentioned",
  request_submitted: "New request submitted",
  request_approved: "Request approved",
  request_rejected: "Request rejected",
  vendor_pending: "New vendor to verify",
  payment_processed: "Payment processed",
  invoice_reminder: "Invoice pending",
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, body, read_at, request_id, vendor_id, created_at, actor:profiles!notifications_actor_id_fkey(full_name)")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const unreadCount = rows.filter((r) => !r.read_at).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {unreadCount === 0 ? "You're all caught up." : `${unreadCount} unread.`}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
              Mark all read
            </button>
          </form>
        )}
      </div>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No notifications yet.</p>
        ) : (
          <ul>
            {rows.map((n) => {
              const href = n.request_id ? `/requests/${n.request_id}` : n.vendor_id ? `/vendors/${n.vendor_id}` : "#";
              return (
                <li
                  key={n.id}
                  className={`border-b border-zinc-100 last:border-b-0 dark:border-zinc-800 ${
                    !n.read_at ? "bg-indigo-50/40 dark:bg-indigo-950/30" : ""
                  }`}
                >
                  <Link href={href} className="flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full">
                      {!n.read_at && <span className="block h-2 w-2 rounded-full bg-indigo-600" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {KIND_LABEL[n.kind] ?? n.kind}
                        {n.actor && <span className="ml-1 font-normal text-zinc-500">by {n.actor.full_name}</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{n.body}</p>
                      <p className="mt-1 text-xs text-zinc-500">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  </Link>
                  {!n.read_at && (
                    <form action={markNotificationRead} className="px-4 pb-2 text-right">
                      <input type="hidden" name="id" value={n.id} />
                      <button className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400">
                        Mark read
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
