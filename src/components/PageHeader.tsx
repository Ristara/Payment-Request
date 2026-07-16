import Link from "next/link";

/**
 * Common page header used across list pages. Stacks vertically on mobile,
 * puts the action button on the right on desktop.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string } | React.ReactNode;
}) {
  const actionNode =
    action && typeof action === "object" && "href" in (action as { href?: string })
      ? (
        <Link
          href={(action as { href: string }).href}
          className="inline-flex shrink-0 items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {(action as { label: string }).label}
        </Link>
      )
      : (action as React.ReactNode);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actionNode}
    </div>
  );
}
