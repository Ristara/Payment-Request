"use client";

import { useEffect } from "react";
import { markThreadRead } from "@/app/requests/actions";

/**
 * Invisible helper: bumps the viewer's read marker for this thread once on
 * mount, so unread-discussion badges on the list pages clear after a visit.
 */
export default function MarkRead({ requestId }: { requestId: string }) {
  useEffect(() => {
    markThreadRead(requestId).catch(() => {});
  }, [requestId]);
  return null;
}
