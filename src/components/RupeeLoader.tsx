/**
 * Branded loading state: the app's rupee tile with a soft expanding halo.
 * Pure CSS animation — safe to render from server components (loading.tsx).
 */
export default function RupeeLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullScreen ? "min-h-screen" : "py-28"
      }`}
    >
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-indigo-500/25" />
        <span className="relative flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white shadow-lg shadow-indigo-600/30">
          ₹
        </span>
      </div>
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
        Loading
      </p>
    </div>
  );
}
