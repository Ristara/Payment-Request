import Link from "next/link";
import VendorForm from "./vendor-form";

export default function NewVendorPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 text-sm">
        <Link href="/vendors" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← All vendors
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">New vendor</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Add vendor details + a cancelled cheque. Accounts will verify + approve before
        you can raise payment requests to them.
      </p>

      <div className="mt-8">
        <VendorForm />
      </div>
    </div>
  );
}
