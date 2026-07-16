"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaInit() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Register the service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Detect standalone (already installed) mode.
    const mql = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(mql.matches);
    const onModeChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mql.addEventListener?.("change", onModeChange);

    // Capture the beforeinstallprompt event for the install button.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Respect user's earlier dismissal (persisted in localStorage).
    if (localStorage.getItem("pwa-install-dismissed") === "1") {
      setDismissed(true);
    }

    // Handle service-worker navigation messages (from notification click).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "navigate" && typeof event.data.url === "string") {
          window.location.assign(event.data.url);
        }
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      mql.removeEventListener?.("change", onModeChange);
    };
  }, []);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") {
      setInstallEvent(null);
    }
  }

  function dismiss() {
    localStorage.setItem("pwa-install-dismissed", "1");
    setDismissed(true);
  }

  // Nothing to show if already installed, dismissed, or no install event yet.
  if (isStandalone || dismissed || !installEvent) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Install Payment Requests
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Get an app icon on your home screen. Loads faster + push notifications.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-zinc-400 hover:text-zinc-600"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={dismiss}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Later
        </button>
        <button
          onClick={installApp}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Install
        </button>
      </div>
    </div>
  );
}
