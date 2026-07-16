"use client";

import { useActionState, useState } from "react";
import { createVendor } from "@/app/vendors/actions";

export default function VendorForm() {
  const [state, formAction, pending] = useActionState(createVendor, undefined);
  const [isGstRegistered, setIsGstRegistered] = useState(true);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Field label="Vendor name" name="name" required placeholder="ABC Suppliers Pvt Ltd" />

      {/* GST registered toggle */}
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          GST registered?
        </label>
        <div className="mt-1 flex gap-2">
          <label
            className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
              isGstRegistered
                ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            <input
              type="radio"
              name="is_gst_registered"
              value="yes"
              checked={isGstRegistered}
              onChange={() => setIsGstRegistered(true)}
              className="sr-only"
            />
            Yes
          </label>
          <label
            className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
              !isGstRegistered
                ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            <input
              type="radio"
              name="is_gst_registered"
              value="no"
              checked={!isGstRegistered}
              onChange={() => setIsGstRegistered(false)}
              className="sr-only"
            />
            No
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            GSTIN {isGstRegistered && <span className="text-red-500">*</span>}
          </label>
          <input
            name="gstin"
            required={isGstRegistered}
            disabled={!isGstRegistered}
            placeholder={isGstRegistered ? "22AAAAA0000A1Z5" : "Not applicable"}
            className={`mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 ${
              !isGstRegistered ? "cursor-not-allowed opacity-50" : ""
            }`}
          />
          {!isGstRegistered && (
            <p className="mt-1 text-[11px] text-zinc-500">
              Skipping — vendor is not GST registered.
            </p>
          )}
        </div>
        <Field label="PAN" name="pan" required placeholder="AAAAA0000A" mono />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bank account number" name="bank_account_number" required mono />
        <Field label="IFSC" name="bank_ifsc" required placeholder="HDFC0001234" mono />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bank name (optional)" name="bank_name" placeholder="HDFC Bank" />
        <Field label="Branch (optional)" name="bank_branch" placeholder="Koramangala" />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Cancelled cheque (optional but recommended)
        </label>
        <input
          type="file"
          name="cancelled_cheque"
          accept="image/*,application/pdf"
          className="mt-1 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-zinc-300"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  mono = false,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
