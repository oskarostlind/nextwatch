"use client";

import { useEffect, useState, useRef } from "react";

const POLL_MS = 5000;
const TOAST_DURATION_MS = 5000;

type Toast = {
  id: string;
  message: string;
  type: "friend" | "group";
};

type FriendsListPayload = {
  ok?: boolean;
  pendingIn?: { requestId: string; from: { id: string; username: string | null; displayName: string | null } }[];
};

type GroupInvitePayload = {
  ok?: boolean;
  incoming?: { id: string; groupCode: string; from?: { displayName: string | null; username: string | null } }[];
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

  useEffect(() => {
    let stop = false;

    const poll = async () => {
      try {
        const [friendsRes, groupRes] = await Promise.all([
          fetch("/api/friends/list", { cache: "no-store" }),
          fetch("/api/group/invite/list", { cache: "no-store" }),
        ]);

        if (stop) return;

        const friendsData = (await friendsRes.json()) as FriendsListPayload;
        const groupData = (await groupRes.json()) as GroupInvitePayload;

        const next: Toast[] = [];

        if (friendsData?.ok && Array.isArray(friendsData.pendingIn)) {
          for (const p of friendsData.pendingIn) {
            const id = `friend-${p.requestId}`;
            if (seenRef.current.has(id)) continue;
            seenRef.current.add(id);
            const name = p.from?.displayName ?? p.from?.username ?? "Någon";
            next.push({ id, message: `${name} vill bli vän med dig`, type: "friend" });
          }
        }

        if (groupData?.ok && Array.isArray(groupData.incoming)) {
          for (const inv of groupData.incoming) {
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
      } catch {
        /* ignore */
      }
      if (!stop) setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      stop = true;
    };
  }, []);

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
