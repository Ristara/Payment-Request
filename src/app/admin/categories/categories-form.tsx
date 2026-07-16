"use client";

import { useActionState, useState } from "react";
import { createCategory, createSubcategory } from "@/app/admin/actions";

type Category = { id: string; name: string; is_active: boolean };
type Subcategory = {
  id: string;
  name: string;
  category_id: string;
  default_coa_head_id: string;
  is_active: boolean;
  coa_heads: { name: string; code: string } | null;
};
type Coa = { id: string; code: string; name: string; is_active: boolean };

export default function CategoriesForm({
  categories,
  subcategories,
  coa,
}: {
  categories: Category[];
  subcategories: Subcategory[];
  coa: Coa[];
}) {
  const [catState, catAction, catPending] = useActionState(createCategory, undefined);
  const [subState, subAction, subPending] = useActionState(createSubcategory, undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <form
        action={catAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">New category name</label>
          <input
            name="name"
            required
            placeholder="IT"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={catPending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {catPending ? "Adding…" : "Add category"}
          </button>
        </div>
        {catState?.error && (
          <p className="sm:col-span-4 text-xs text-red-600 dark:text-red-400">{catState.error}</p>
        )}
        {catState?.info && (
          <p className="sm:col-span-4 text-xs text-emerald-600 dark:text-emerald-400">{catState.info}</p>
        )}
      </form>

      {coa.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          You need to add at least one <strong>COA head</strong> before you can add subcategories.
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {categories.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No categories yet. Add your first above.
          </p>
        ) : (
          <ul>
            {categories.map((cat) => {
              const subs = subcategories.filter((s) => s.category_id === cat.id);
              const isOpen = expanded.has(cat.id);
              return (
                <li key={cat.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => toggle(cat.id)}
                    className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-lg text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{cat.name}</span>
                      <span className="text-xs text-zinc-500">
                        {subs.length} subcategor{subs.length === 1 ? "y" : "ies"}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4">
                      {subs.length > 0 && (
                        <ul className="mb-3 space-y-1 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
                          {subs.map((s) => (
                            <li key={s.id} className="text-sm">
                              <span className="text-zinc-800 dark:text-zinc-200">{s.name}</span>
                              <span className="text-zinc-400 dark:text-zinc-500"> → </span>
                              <span className="text-xs text-zinc-500">
                                {s.coa_heads?.name ?? "—"}{" "}
                                {s.coa_heads?.code && (
                                  <span className="font-mono">({s.coa_heads.code})</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {coa.length > 0 && (
                        <form action={subAction} className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                          <input type="hidden" name="category_id" value={cat.id} />
                          <input
                            name="name"
                            required
                            placeholder="Subcategory name"
                            className="sm:col-span-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                          />
                          <select
                            name="default_coa_head_id"
                            required
                            defaultValue=""
                            className="sm:col-span-3 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            <option value="" disabled>
                              Pick default COA head…
                            </option>
                            {coa.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.code})
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={subPending}
                            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {subPending ? "Adding…" : "Add"}
                          </button>
                          {subState?.error && (
                            <p className="sm:col-span-6 text-xs text-red-600 dark:text-red-400">
                              {subState.error}
                            </p>
                          )}
                        </form>
                      )}
                    </div>
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
