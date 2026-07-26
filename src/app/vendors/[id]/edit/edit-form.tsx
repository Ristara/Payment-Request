"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { updateVendor } from "@/app/vendors/actions";

export type EditableVendor = {
  id: string;
  name: string;
  gstin: string | null;
  pan: string;
  phone: string | null;
  email: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  bank_branch: string | null;
};

export default function VendorEditForm({ vendor }: { vendor: EditableVendor }) {
  const [state, formAction, pending] = useActionState(updateVendor, undefined);
  const [isGstRegistered, setIsGstRegistered] = useState(!!vendor.gstin);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input type="hidden" name="id" value={vendor.id} />

      <Field label="Vendor name" name="name" required defaultValue={vendor.name} />

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          GST registered?
        </label>
        <div className="mt-1 flex gap-2">
          {([true, false] as const).map((yes) => (
            <label
              key={String(yes)}
              className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
                isGstRegistered === yes
                  ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="is_gst_registered"
                value={yes ? "yes" : "no"}
                checked={isGstRegistered === yes}
                onChange={() => setIsGstRegistered(yes)}
                className="sr-only"
              />
              {yes ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isGstRegistered && (
          <Field
            label="GSTIN"
            name="gstin"
            required
            defaultValue={vendor.gstin ?? ""}
            placeholder="29AAAAA0000A1Z5"
            mono
          />
        )}
        <Field label="PAN" name="pan" required defaultValue={vendor.pan} placeholder="AAAAA0000A" mono />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Mobile number"
          name="phone"
          required
          type="tel"
          defaultValue={vendor.phone ?? ""}
          placeholder="98765 43210"
        />
        <Field
          label="Email (optional)"
          name="email"
          type="email"
          defaultValue={vendor.email ?? ""}
          placeholder="accounts@vendor.com"
        />
      </div>

      <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Bank details</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Account number"
            name="bank_account_number"
            defaultValue={vendor.bank_account_number ?? ""}
            mono
          />
          <Field label="IFSC" name="bank_ifsc" defaultValue={vendor.bank_ifsc ?? ""} placeholder="HDFC0001234" mono />
          <Field label="Bank name" name="bank_name" defaultValue={vendor.bank_name ?? ""} />
          <Field label="Branch" name="bank_branch" defaultValue={vendor.bank_branch ?? ""} />
        </div>
      </div>

      {state?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link
          href={`/vendors/${vendor.id}`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  defaultValue,
  placeholder,
  type = "text",
  mono = false,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 ${
          mono ? "font-mono uppercase" : ""
        }`}
      />
    </div>
  );
}
