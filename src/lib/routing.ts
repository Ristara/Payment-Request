/**
 * Central place for shared string tables + formatting helpers used across
 * the app. Kept small on purpose — expand as needed.
 */

export { ROLE_LABEL, STATUS_LABEL, formatINR } from "./types";

export const VENDOR_STATUS_LABEL: Record<string, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const SUPPLY_LABEL: Record<string, string> = {
  material: "100% Material",
  service: "100% Service",
  mixed: "Mixed",
};

export const PAYMENT_MODE_LABEL: Record<string, string> = {
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function avatarColor(seed: string): string {
  const palette = [
    "bg-indigo-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-sky-500",
    "bg-rose-500",
    "bg-violet-500",
    "bg-teal-500",
    "bg-orange-500",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

export function timeShort(iso: string): string {
  // Pin IST: SSR runs in UTC, and pinning also avoids hydration mismatches.
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
