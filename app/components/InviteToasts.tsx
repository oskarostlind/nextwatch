"use client";

import { useEffect, useState, useRef } from "react";
import { useSocial } from "./client/SocialProvider";

const TOAST_DURATION_MS = 5000;

type Toast = {
  id: string;
  message: string;
  type: "friend" | "group";
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="alert"
      className="mb-2 flex min-w-[260px] max-w-[90vw] items-start gap-2 rounded-xl border border-white/10 bg-neutral-800 px-4 py-3 shadow-lg backdrop-blur"
    >
      <span className="text-sm text-white/90">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto shrink-0 rounded p-1 text-white/50 hover:text-white/80"
        aria-label="Stäng"
      >
        ×
      </button>
    </div>
  );
}

export default function InviteToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Läser den delade social-store:n (poller i SocialPreloader) — inga egna
  // fetch-anrop här; komponenten diffar bara fram nya förfrågningar/inbjudningar.
  const social = useSocial();

  useEffect(() => {
    const next: Toast[] = [];

    if (social.friendsReady) {
      for (const p of social.pendingIn) {
        const id = `friend-${p.requestId}`;
        if (seenRef.current.has(id)) continue;
        seenRef.current.add(id);
        const name = p.from?.displayName ?? p.from?.username ?? "Någon";
        next.push({ id, message: `${name} vill bli vän med dig`, type: "friend" });
      }
    }

    if (social.invitesReady) {
      for (const inv of social.invitesIncoming) {
        const id = `group-${inv.id}`;
        if (seenRef.current.has(id)) continue;
        seenRef.current.add(id);
        const name = inv.from?.displayName ?? inv.from?.username ?? "Någon";
        next.push({
          id,
          message: `${name} bjöd in dig till grupp ${inv.groupCode}`,
          type: "group",
        });
      }
    }

    if (next.length > 0) {
      setToasts((prev) => [...prev, ...next]);
    }
  }, [social]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-[100] flex flex-col items-end md:bottom-6 md:left-auto md:right-6">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
