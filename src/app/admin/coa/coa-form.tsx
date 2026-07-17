"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createCoaAccount,
  deleteCoaAccount,
  renameCategoryGroup,
  renameCoaGroup,
  toggleCoaAccountActive,
  updateCoaAccount,
} from "@/app/admin/actions";

type Row = {
  id: string;
  code: number;
  subcategory: string;
  category: string;
  coa: string;
  is_active: boolean;
};

type Tree = {
  coa: string;
  categories: { category: string; subs: Row[] }[];
}[];

/**
 * Zoho Expense-style tree editor for the Chart of Accounts.
 *
 * Underlying storage is still one flat coa_accounts table where each row
 * is a leaf subcategory that also carries its Category and COA names as
 * text. This UI treats those two columns as "groups" — renaming a group
 * updates every row that shares that label (via the rename* actions).
 *
 *   COA head
 *     ↳ Category
 *         ↳ Subcategory (leaf: the real DB row)
 *
 * Add flow: any "+ Add" always ends in creating a leaf row. Adding at a
 * higher level just asks for the missing labels too.
 */
export default function CoaForm({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState("");

  const tree: Tree = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCoa = new Map<string, Map<string, Row[]>>();
    for (const r of rows) {
      if (
        q &&
        !r.subcategory.toLowerCase().includes(q) &&
        !r.category.toLowerCase().includes(q) &&
        !r.coa.toLowerCase().includes(q) &&
        !String(r.code).includes(q)
      ) continue;
      let cats = byCoa.get(r.coa);
      if (!cats) { cats = new Map(); byCoa.set(r.coa, cats); }
      const subs = cats.get(r.category) ?? [];
      subs.push(r);
      cats.set(r.category, subs);
    }
    return [...byCoa.keys()].sort((a, b) => a.localeCompare(b)).map((coa) => ({
      coa,
      categories: [...(byCoa.get(coa) ?? new Map()).entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, subs]) => ({
          category,
          subs: [...subs].sort((x, y) => x.subcategory.localeCompare(y.subcategory)),
        })),
    }));
  }, [rows, query]);

  const totalMatches = tree.reduce(
    (s, coa) => s + coa.categories.reduce((ss, c) => ss + c.subs.length, 0),
    0,
  );

  const [addingNewCoa, setAddingNewCoa] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header row: search + add COA head */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, subcategory, category, COA…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">
            {query
              ? `${totalMatches} match${totalMatches === 1 ? "" : "es"}`
              : `${rows.length} account${rows.length === 1 ? "" : "s"}`}
          </p>
          <button
            type="button"
            onClick={() => setAddingNewCoa(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            + Add COA head
          </button>
        </div>
      </div>

      {addingNewCoa && (
        <AddInlineForm
          heading="New COA head"
          fields={[
            { name: "coa", label: "COA head", placeholder: "e.g. Marketing" },
            { name: "category", label: "Category", placeholder: "e.g. Digital Ads" },
            { name: "subcategory", label: "Subcategory", placeholder: "e.g. Google Ads" },
          ]}
          onDone={() => setAddingNewCoa(false)}
        />
      )}

      {/* Tree */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {tree.length === 0 ? (
          <p className="p-10 text-center text-sm text-zinc-500">
            {rows.length === 0 ? "No accounts yet. Add your first COA head." : `No matches for "${query}".`}
          </p>
        ) : (
          <ul>
            {tree.map((coaNode) => (
              <CoaNode key={coaNode.coa} node={coaNode} openByDefault={!!query} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CoaNode({ node, openByDefault }: { node: Tree[number]; openByDefault: boolean }) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameState, renameAction, renamePending] = useActionState(renameCoaGroup, undefined);

  return (
    <li className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
      <details open={openByDefault} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
          <Chevron />
          {renaming ? (
            <form
              action={renameAction}
              onClick={(e) => e.preventDefault()}
              className="flex flex-1 items-center gap-2"
            >
              <input type="hidden" name="old_coa" value={node.coa} />
              <input
                name="new_coa"
                defaultValue={node.coa}
                required
                autoFocus
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="submit"
                disabled={renamePending}
                onClick={() => setRenaming(false)}
                className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{node.coa}</span>
              <span className="text-[11px] text-zinc-500">
                {node.categories.length} cat · {node.categories.reduce((s, c) => s + c.subs.length, 0)} sub
              </span>
              <RowMenu
                onRename={() => setRenaming(true)}
              />
            </>
          )}
        </summary>

        {renameState?.error && (
          <p className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">{renameState.error}</p>
        )}

        <div className="pb-2 pl-6">
          <ul>
            {node.categories.map((catNode) => (
              <CategoryNode
                key={catNode.category}
                coa={node.coa}
                node={catNode}
                openByDefault={openByDefault}
              />
            ))}
          </ul>

          <div className="mt-1 pl-4">
            {addingCategory ? (
              <AddInlineForm
                heading={`New category under ${node.coa}`}
                fixed={{ coa: node.coa }}
                fields={[
                  { name: "category", label: "Category", placeholder: "e.g. Digital Ads" },
                  { name: "subcategory", label: "Subcategory", placeholder: "e.g. Google Ads" },
                ]}
                onDone={() => setAddingCategory(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingCategory(true)}
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                + Add category
              </button>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

function CategoryNode({
  coa,
  node,
  openByDefault,
}: {
  coa: string;
  node: { category: string; subs: Row[] };
  openByDefault: boolean;
}) {
  const [addingSub, setAddingSub] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameState, renameAction, renamePending] = useActionState(renameCategoryGroup, undefined);

  return (
    <li className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60">
      <details open={openByDefault} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
          <Chevron />
          {renaming ? (
            <form
              action={renameAction}
              onClick={(e) => e.preventDefault()}
              className="flex flex-1 items-center gap-2"
            >
              <input type="hidden" name="coa" value={coa} />
              <input type="hidden" name="old_category" value={node.category} />
              <input
                name="new_category"
                defaultValue={node.category}
                required
                autoFocus
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="submit"
                disabled={renamePending}
                onClick={() => setRenaming(false)}
                className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">{node.category}</span>
              <span className="text-[11px] text-zinc-500">{node.subs.length}</span>
              <RowMenu onRename={() => setRenaming(true)} />
            </>
          )}
        </summary>

        {renameState?.error && (
          <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{renameState.error}</p>
        )}

        <ul className="pb-1 pl-6">
          {node.subs.map((s) => (
            <SubcategoryRow key={s.id} row={s} />
          ))}
        </ul>

        <div className="pb-2 pl-6">
          {addingSub ? (
            <AddInlineForm
              heading={`New subcategory under ${node.category}`}
              fixed={{ coa, category: node.category }}
              fields={[
                { name: "subcategory", label: "Subcategory", placeholder: "e.g. Google Ads" },
              ]}
              onDone={() => setAddingSub(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingSub(true)}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              + Add subcategory
            </button>
          )}
        </div>
      </details>
    </li>
  );
}

function SubcategoryRow({ row }: { row: Row }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(updateCoaAccount, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCoaAccount, undefined);

  return (
    <li className="flex items-center gap-2 py-1.5 pr-2 text-sm">
      <span className="text-zinc-400">↳</span>
      {editing ? (
        <form
          action={(fd) => { editAction(fd); setEditing(false); }}
          className="flex flex-1 items-center gap-2"
        >
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="category" value={row.category} />
          <input type="hidden" name="coa" value={row.coa} />
          <input
            name="subcategory"
            defaultValue={row.subcategory}
            required
            autoFocus
            className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={editPending}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className={`flex-1 truncate ${row.is_active ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 line-through"}`}>
            {row.subcategory}
          </span>
          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{row.code}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Rename
          </button>
          <form action={toggleCoaAccountActive}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="is_active" value={row.is_active ? "false" : "true"} />
            <button
              type="submit"
              className="text-[11px] font-medium text-zinc-500 hover:underline"
            >
              {row.is_active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
          <form
            action={deleteAction}
            onSubmit={(e) => {
              if (!confirm(`Delete "${row.subcategory}" (code ${row.code})? This can't be undone.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              disabled={deletePending}
              className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
            >
              Delete
            </button>
          </form>
        </>
      )}
      {editState?.error && (
        <span className="ml-2 text-[10px] text-red-600 dark:text-red-400">{editState.error}</span>
      )}
      {deleteState?.error && (
        <span className="ml-2 text-[10px] text-red-600 dark:text-red-400">{deleteState.error}</span>
      )}
    </li>
  );
}

function AddInlineForm({
  heading,
  fields,
  fixed = {},
  onDone,
}: {
  heading: string;
  fields: { name: string; label: string; placeholder: string }[];
  fixed?: Record<string, string>;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createCoaAccount, undefined);
  return (
    <form
      action={(fd) => {
        action(fd);
      }}
      className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-800 dark:bg-indigo-950/20"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
        {heading}
      </p>
      {Object.entries(fixed).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">{f.label}</label>
            <input
              name={f.name}
              required
              autoFocus={f === fields[fields.length - 1]}
              placeholder={f.placeholder}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        ))}
      </div>
      {state?.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="flex-none text-zinc-400 transition-transform group-open:rotate-90"
    >
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RowMenu({ onRename }: { onRename: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Prevent the enclosing <summary> from toggling the disclosure.
        e.preventDefault();
        e.stopPropagation();
        onRename();
      }}
      className="rounded p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
      aria-label="Rename"
      title="Rename"
    >
      ✎
    </button>
  );
}
