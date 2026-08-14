"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { MessageCircle } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import Avatar from "@/app/components/ui/Avatar";
import { useTranslations } from "next-intl";

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

/**
 * Tar emot t() i stället för att formatera själv — pluralformerna
 * ("1 dag" / "2 dagar") ligger som ICU-plural i messages/*.json.
 */
function lastActiveLabel(
  iso: string | null,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (!iso) return t("neverActive");
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("activeJustNow");
  if (min < 60) return t("activeMinutesAgo", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("activeHoursAgo", { count: h });
  const d = Math.floor(h / 24);
  return t("activeDaysAgo", { count: d });
}

export default function FriendProfileModal({
  friendId,
  onClose,
  onOpenChat,
  onReport,
}: {
  friendId: string | null;
  onClose: () => void;
  /** Öppnar filmchatten med vännen (stänger profilen först). */
  onOpenChat?: (friendId: string) => void;
  /** Öppnar anmälningsdialogen (Guideline 1.2 — nåbar från profilen). */
  onReport?: (friendId: string) => void;
}) {
  const t = useTranslations("friendProfile");
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
        else setError(j?.message ?? t("loadFailed"));
      })
      .catch(() => active && setError(t("networkError")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                <p className="mt-1 text-xs text-emerald-300/80">{lastActiveLabel(prof.lastActiveAt, t)}</p>
              </div>
            </div>

            {onOpenChat && (
              <button
                type="button"
                onClick={() => onOpenChat(prof.id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
              >
                <MessageCircle className="h-4 w-4" />
                {t("openChat")}
              </button>
            )}

            {prof.genres.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">{t("likes")}</h4>
                <div className="flex flex-wrap gap-2">
                  {prof.genres.map((g) => (
                    <span key={g} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {onReport && (
              <button
                type="button"
                onClick={() => onReport(prof.id)}
                className="w-full rounded-xl border border-white/10 py-2 text-xs font-medium text-white/50 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                {t("reportUser")}
              </button>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">{t("recentFavorites")}</h4>
              {prof.top3.length === 0 ? (
                <p className="text-sm text-white/40">{t("noLikesYet")}</p>
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
