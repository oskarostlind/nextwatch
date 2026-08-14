"use client";

// Matchningar-fliken: gruppens matchhistorik (från GroupMatch, se lib/push.ts
// notifyGroupMatchIfNeeded) i stället för matchrutan som bara visar EN
// okvitterad kandidat och sedan försvinner. Detaljvyn återanvänder samma
// providerGroupsFor/bestWatchUrl-uppslag och Modal/WatchNowButton som
// watchlisten, så "Kolla nu" alltid länkar till den riktiga tjänsten.

import { useMemo, useState } from "react";
import Image from "next/image";
import Modal from "@/app/components/ui/Modal";
import PosterImage from "@/app/components/ui/PosterImage";
import { PosterGridSkeleton } from "@/app/components/ui/Skeletons";
import WatchNowButton from "@/app/components/watch/WatchNowButton";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { useTranslations } from "next-intl";
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  providerWatchUrl,
  type WatchProviders,
} from "@/lib/watchLinks";

export type GroupMatchItem = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  matchedAt: string;
  title: string;
  year: number | null;
  poster: string | null;
  rating: number | null;
  overview: string | null;
  providers: WatchProviders | null;
};

function posterUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w342${path}`;
}

export default function MatchesTab({
  code,
  items,
}: {
  code: string | null;
  items: GroupMatchItem[] | null;
}) {
  const t = useTranslations("groupMatches");
  const tw = useTranslations("watch");
  const { showPaidOptions } = useSwipeSettings();
  const [active, setActive] = useState<GroupMatchItem | null>(null);

  const providers = active?.providers ?? null;
  const providerGroups = useMemo(() => providerGroupsFor(providers, showPaidOptions), [providers, showPaidOptions]);
  const paidOnly = useMemo(() => isPaidOnly(providers, showPaidOptions), [providers, showPaidOptions]);
  const watchUrl = useMemo(
    () => (active ? bestWatchUrl(providers, active.title, showPaidOptions) : undefined),
    [providers, active, showPaidOptions]
  );

  if (!code) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
        {t("noGroup")}
      </div>
    );
  }

  if (items === null) {
    // Skelett i posterformat i stället för en naken textrad — samma yta som
    // det färdiga gridet, så listan inte hoppar när datan landar.
    return <PosterGridSkeleton count={4} />;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
        {t("noMatches")}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <button
            key={`${it.tmdbType}-${it.tmdbId}`}
            type="button"
            onClick={() => setActive(it)}
            className="group relative overflow-hidden rounded-xl border border-white/10 text-left transition hover:ring-2 hover:ring-cyan-500/60"
          >
            {posterUrl(it.poster) ? (
              <PosterImage
                src={posterUrl(it.poster)!}
                alt={it.title}
                width={342}
                height={513}
                className="aspect-[2/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex aspect-[2/3] w-full items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                {it.title}
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
              <div className="truncate font-medium text-white">{it.title}</div>
              <div className="flex items-center justify-between opacity-90">
                <span>{it.year ?? "—"}</span>
                {typeof it.rating === "number" && <span>★ {it.rating.toFixed(1)}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Modal open={active !== null} onClose={() => setActive(null)} labelledBy="group-match-modal-title">
        {active && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative mx-auto h-[320px] w-[220px] shrink-0 overflow-hidden rounded-2xl md:mx-0">
              {posterUrl(active.poster) ? (
                <Image src={posterUrl(active.poster)!} alt={active.title} fill sizes="220px" className="object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center bg-neutral-800 text-neutral-400">{t("noImage")}</div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h2 id="group-match-modal-title" className="text-xl font-bold text-white">
                {active.title}
                {active.year ? ` (${active.year})` : ""}
              </h2>
              {typeof active.rating === "number" && (
                <p className="mt-1 text-sm text-neutral-300">Betyg: {active.rating.toFixed(1)}</p>
              )}

              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {active.overview || t("noDescription")}
              </p>

              <div className="mt-4 space-y-3">
                {providerGroups.length === 0 && (
                  <p className="text-sm text-neutral-400">
                    {paidOnly ? tw("paidOnly") : t("noStreamingData")}
                  </p>
                )}
                {providerGroups.map(({ labelKey, list }) => (
                  <div key={labelKey}>
                    <p className="mb-2 text-xs uppercase tracking-widest text-cyan-400/80">{tw(`group.${labelKey}`)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {list.map((p) => {
                        const href = providerWatchUrl(p.provider_name, active.title);
                        const inner = (
                          <>
                            {p.logo_path && (
                              <span className="relative inline-block h-5 w-5 overflow-hidden rounded">
                                <Image
                                  src={`https://image.tmdb.org/t/p/w92${p.logo_path}`}
                                  alt={p.provider_name}
                                  fill
                                  sizes="20px"
                                  className="object-contain"
                                />
                              </span>
                            )}
                            {p.provider_name}
                          </>
                        );
                        const cls =
                          "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-neutral-200";
                        return href ? (
                          <a
                            key={p.provider_name}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${cls} transition hover:border-cyan-400/40 hover:bg-cyan-400/10`}
                            title={t("openProvider", { provider: p.provider_name })}
                          >
                            {inner}
                          </a>
                        ) : (
                          <span key={p.provider_name} className={cls} title={p.provider_name}>
                            {inner}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <WatchNowButton url={watchUrl} />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
