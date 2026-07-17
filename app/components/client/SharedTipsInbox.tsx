"use client";

// Kompakt ingång till filmchatten från /watchlist: en rad per vän med OLÄSTA
// tips ("3 nya tips från Anna") som öppnar tråden. Själva läsandet, "Lägg
// till" och svaren sker i FilmChatModal — chatten är primärytan. Osynlig när
// inget är oläst.

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, ChevronRight } from "lucide-react";
import Avatar from "@/app/components/ui/Avatar";
import FilmChatModal from "@/app/components/client/FilmChatModal";

type Thread = {
  friendId: string;
  lastTitle: string;
  lastAt: string;
  unseen: number;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
};

type ThreadsResp = { ok?: boolean; threads?: Thread[] };

export default function SharedTipsInbox({ onAdded }: { onAdded?: () => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [chatFriend, setChatFriend] = useState<Thread | null>(null);

  const load = useCallback(() => {
    void fetch("/api/share/threads", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ThreadsResp>) : null))
      .then((j) => {
        if (j?.ok) setThreads((j.threads ?? []).filter((t) => t.unseen > 0));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const name = (t: Thread) => t.displayName ?? t.username ?? "En vän";

  return (
    <>
      {threads.length > 0 && (
        <section className="mb-5 grid gap-2">
          {threads.map((t) => (
            <button
              key={t.friendId}
              type="button"
              onClick={() => setChatFriend(t)}
              className="flex w-full items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 px-3 py-2.5 text-left transition hover:bg-cyan-400/10"
            >
              <Avatar avatarId={t.avatarId} name={name(t)} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white/90">
                  {t.unseen} {t.unseen === 1 ? "nytt tips" : "nya tips"} från {name(t)}
                </span>
                <span className="block truncate text-xs text-white/45">Senast: {t.lastTitle}</span>
              </span>
              <MessageCircle className="h-4 w-4 shrink-0 text-cyan-300" />
              <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
            </button>
          ))}
        </section>
      )}

      <FilmChatModal
        friendId={chatFriend?.friendId ?? null}
        friendName={chatFriend ? name(chatFriend) : ""}
        friendAvatarId={chatFriend?.avatarId ?? null}
        onClose={() => {
          setChatFriend(null);
          load(); // tråd-GET:en har nollat olästa — uppdatera raderna
        }}
        onWatchlistAdd={onAdded}
      />
    </>
  );
}
