"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { MessageCircle } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import Avatar from "@/app/components/ui/Avatar";

type Top = { tmdbId: number; tmdbType: "movie" | "tv"; title: string; year: string | null; poster: string | null };
type Prof = {
  id: string;
  displayName: string;
  username: string | null;
  avatarId: string | null;
  genres: string[];
  top3: Top[];
  lastActiveAt: string | null;
};

function lastActiveLabel(iso: string | null): string {
  if (!iso) return "Aldrig aktiv";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Aktiv nyss";
  if (min < 60) return `Aktiv för ${min} min sedan`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Aktiv för ${h} tim sedan`;
  const d = Math.floor(h / 24);
  return `Aktiv för ${d} ${d === 1 ? "dag" : "dagar"} sedan`;
}

export default function FriendProfileModal({
  friendId,
  onClose,
  onOpenChat,
}: {
  friendId: string | null;
  onClose: () => void;
  /** Öppnar filmchatten med vännen (stänger profilen först). */
  onOpenChat?: (friendId: string) => void;
}) {
  const [prof, setProf] = useState<Prof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!friendId) {
      setProf(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setProf(null);
    fetch(`/api/friends/${encodeURIComponent(friendId)}/profile`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        if (j?.ok) setProf(j.profile as Prof);
        else setError(j?.message ?? "Kunde inte hämta profilen.");
      })
      .catch(() => active && setError("Nätverksfel."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [friendId]);

  return (
    <Modal open={!!friendId} onClose={onClose}>
      <div className="p-2">
        {loading && <p className="py-8 text-center text-sm text-white/50">Laddar…</p>}
        {error && <p className="py-8 text-center text-sm text-rose-300">{error}</p>}
        {prof && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar avatarId={prof.avatarId} name={prof.displayName} size={56} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xl font-bold text-white">{prof.displayName}</h3>
                {prof.username && <p className="text-sm text-white/40">@{prof.username}</p>}
                <p className="mt-1 text-xs text-emerald-300/80">{lastActiveLabel(prof.lastActiveAt)}</p>
              </div>
            </div>

            {onOpenChat && (
              <button
                type="button"
                onClick={() => onOpenChat(prof.id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
              >
                <MessageCircle className="h-4 w-4" />
                Öppna filmchatt
              </button>
            )}

            {prof.genres.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Gillar</h4>
                <div className="flex flex-wrap gap-2">
                  {prof.genres.map((g) => (
                    <span key={g} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Senaste favoriter</h4>
              {prof.top3.length === 0 ? (
                <p className="text-sm text-white/40">Har inte gillat något än.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {prof.top3.map((t) => (
                    <div key={`${t.tmdbType}-${t.tmdbId}`} className="space-y-1">
                      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/5">
                        {t.poster ? (
                          <Image src={t.poster} alt={t.title} fill sizes="120px" className="object-cover" unoptimized />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-white/30">Ingen bild</div>
                        )}
                      </div>
                      <p className="truncate text-xs text-white/70" title={t.title}>
                        {t.title}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
