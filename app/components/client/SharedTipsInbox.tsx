"use client";

// Kompakt ingång till filmchatten från /watchlist: en rad per vän med OLÄSTA
// tips ("3 nya tips från Anna") som öppnar tråden. Själva läsandet, "Lägg
// till" och svaren sker i FilmChatModal — chatten är primärytan. Osynlig när
// inget är oläst.

import { useState } from "react";
import { MessageCircle, ChevronRight } from "lucide-react";
import Avatar from "@/app/components/ui/Avatar";
import FilmChatModal from "@/app/components/client/FilmChatModal";
import { refreshThreads, useShareThreads, type ShareThread } from "@/lib/threadsStore";
import { useTranslations } from "next-intl";

export default function SharedTipsInbox({ onAdded }: { onAdded?: () => void }) {
  const t = useTranslations("tips");
  // Delade threads-storen — samma poll som navbadgen och vänlistan.
  const { threads: allThreads } = useShareThreads();
  const threads = allThreads.filter((t) => t.unseen > 0);
  const [chatFriend, setChatFriend] = useState<ShareThread | null>(null);

  const name = (thread: ShareThread) => thread.displayName ?? thread.username ?? t("aFriend");

  return (
    <>
      {threads.length > 0 && (
        <section className="mb-5 grid gap-2">
          {threads.map((thread) => (
            <button
              key={thread.friendId}
              type="button"
              onClick={() => setChatFriend(thread)}
              className="flex w-full items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 px-3 py-2.5 text-left transition hover:bg-cyan-400/10"
            >
              <Avatar avatarId={thread.avatarId} name={name(thread)} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white/90">
                  {t("newTips", { count: thread.unseen, name: name(thread) })}
                </span>
                <span className="block truncate text-xs text-white/45">{t("latest", { title: thread.lastTitle })}</span>
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
          void refreshThreads(); // tråd-GET:en har nollat olästa — uppdatera raderna
        }}
        onWatchlistAdd={onAdded}
      />
    </>
  );
}
