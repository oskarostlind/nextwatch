"use client";

// "Tipsa en vän": välj vän → tipset (titelkortet) skickas via /api/share/send.
// Ingen fritext — kortet är meddelandet. Vänlistan hämtas vid öppning i stället
// för via socialStore: modalen används från ytor (t.ex. /watchlist) där
// SocialProvider-pollningen inte behöver vara igång.

import { useEffect, useState } from "react";
import Modal from "@/app/components/ui/Modal";
import Avatar from "@/app/components/ui/Avatar";
import { useShareThreads } from "@/lib/threadsStore";

export type ShareItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year?: string | null;
  poster?: string | null;
};

type Friend = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId?: string | null;
};

type FriendsResp = {
  ok?: boolean;
  friends?: { other?: Friend }[];
};

type SendState = "idle" | "sending" | "sent" | "error";

export default function ShareTitleModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: ShareItem | null;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const [q, setQ] = useState("");
  // Senast interagerad (share/threads lastAt) → standard-sorteringen. Läses ur
  // delade threads-storen — ingen egen hämtning.
  const { threads } = useShareThreads();
  const lastAtByFriend: Record<string, string> = {};
  for (const t of threads) lastAtByFriend[t.friendId] = t.lastAt;

  useEffect(() => {
    if (!open) {
      setSendState({});
      setQ("");
      return;
    }
    let active = true;
    fetch("/api/friends/list", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<FriendsResp>) : null))
      .then((j) => {
        if (!active) return;
        const list = (j?.friends ?? [])
          .map((f) => f.other)
          .filter((f): f is Friend => Boolean(f?.id));
        setFriends(list);
      })
      .catch(() => active && setFriends([]));
    return () => {
      active = false;
    };
  }, [open]);

  async function send(friendId: string) {
    if (!item) return;
    setSendState((s) => ({ ...s, [friendId]: "sending" }));
    try {
      const res = await fetch("/api/share/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ toUserId: friendId, ...item }),
      });
      const j = (await res.json()) as { ok?: boolean };
      setSendState((s) => ({ ...s, [friendId]: res.ok && j.ok ? "sent" : "error" }));
    } catch {
      setSendState((s) => ({ ...s, [friendId]: "error" }));
    }
  }

  const name = (f: Friend) => f.displayName ?? f.username ?? "Okänd";

  // Senast tipsad-med först (chattens rytm), övriga alfabetiskt; sök filtrerar.
  const needle = q.trim().toLowerCase();
  const sortedFilteredFriends = (friends ?? [])
    .filter((f) => !needle || name(f).toLowerCase().includes(needle) || (f.username ?? "").toLowerCase().includes(needle))
    .sort((a, b) => {
      const la = lastAtByFriend[a.id] ?? "";
      const lb = lastAtByFriend[b.id] ?? "";
      if (la !== lb) return lb.localeCompare(la);
      return name(a).localeCompare(name(b), "sv");
    });

  return (
    <Modal open={open} onClose={onClose} labelledBy="share-title-heading">
      <div className="p-2">
        <h3 id="share-title-heading" className="text-lg font-bold text-white">
          Tipsa en vän
        </h3>
        {item && (
          <p className="mt-0.5 text-sm text-white/50">
            {item.title}
            {item.year ? ` (${item.year})` : ""}
          </p>
        )}

        {(friends?.length ?? 0) > 3 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök vän…"
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
          />
        )}

        <div className="mt-4 grid gap-2">
          {friends === null ? (
            <p className="py-6 text-center text-sm text-white/50">Laddar vänner…</p>
          ) : friends.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/50">
              Inga vänner än — lägg till någon under Grupp → Vänner först.
            </p>
          ) : (
            sortedFilteredFriends.map((f) => {
              const st = sendState[f.id] ?? "idle";
              return (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar avatarId={f.avatarId} name={name(f)} size={34} />
                    <span className="truncate text-sm font-medium text-white/90">{name(f)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={st === "sending" || st === "sent"}
                    onClick={() => void send(f.id)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      st === "sent"
                        ? "bg-emerald-600/20 text-emerald-300"
                        : st === "error"
                        ? "bg-rose-600/20 text-rose-300"
                        : "bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-60"
                    }`}
                  >
                    {st === "sent" ? "Skickat ✓" : st === "sending" ? "Skickar…" : st === "error" ? "Försök igen" : "Skicka"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl py-2.5 text-sm text-white/50 transition hover:text-white/80"
        >
          Stäng
        </button>
      </div>
    </Modal>
  );
}
