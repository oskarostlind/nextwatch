"use client";

// Gruppinställningar (kugghjulet) — endast gruppens skapare kan spara.
// Tomma val = automatik: genrer/providers unionas från medlemmarnas profiler,
// åldersgräns från yngsta medlemmen, matchtröskel 60 % av gruppens storlek.
// Satta värden åsidosätter automatiken (se lib/unifiedRecs.ts + lib/groupSettings.ts).
//
// Matchtröskeln lagras som ett antal PERSONER (inte procent) och klamras
// alltid till gruppens aktuella storlek vid matchberäkning (groupMatchNeed).

import { useEffect, useState } from "react";
import Modal from "@/app/components/ui/Modal";
import { notify } from "@/app/components/lib/notify";
import { ensureGroupDeck } from "@/lib/swipeDeckStore";
import {
  GROUP_CERTS,
  GROUP_GENRES,
  MIN_MATCH_THRESHOLD,
  groupMatchNeed,
  type GroupCert,
  type GroupSettings,
  type SwipeMediaFilter,
} from "@/lib/groupSettings";
import { Button, Chip, SegmentedTabs } from "@/app/components/ui/kit";
import GenrePicker from "@/app/components/discover/GenrePicker";
import { PROVIDERS } from "@/lib/providers";
import { subgenresFor, toggleKeywordGroup } from "@/lib/subgenres";

type SettingsResp = {
  ok: boolean;
  message?: string;
  isCreator?: boolean;
  settings?: GroupSettings;
  memberCount?: number;
};

/** Rubricerad sektion med diskret ram runt innehållet (matchar profilsidans stil). */
function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div>
        <h4 className="text-sm font-semibold text-white/80">{title}</h4>
        {hint && <p className="mt-0.5 text-xs text-white/40">{hint}</p>}
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">{children}</div>
    </section>
  );
}

export default function GroupSettingsModal({
  code,
  open,
  onClose,
}: {
  code: string;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memberCount, setMemberCount] = useState(0);
  const [likedGenres, setLikedGenres] = useState<string[]>([]);
  const [dislikedGenres, setDislikedGenres] = useState<string[]>([]);
  const [favoriteKeywordIds, setFavoriteKeywordIds] = useState<number[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [maxCert, setMaxCert] = useState<GroupCert | null>(null);
  const [thresholdCount, setThresholdCount] = useState<number>(MIN_MATCH_THRESHOLD);
  const [thresholdCustom, setThresholdCustom] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<SwipeMediaFilter>("both");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/group/settings?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<SettingsResp>)
      .then((j) => {
        if (cancelled) return;
        if (!j.ok || !j.settings) {
          setError(j.message ?? "Kunde inte läsa inställningarna.");
          return;
        }
        const n = j.memberCount ?? 0;
        setMemberCount(n);
        setLikedGenres(j.settings.favoriteGenres);
        setDislikedGenres(j.settings.dislikedGenres);
        setFavoriteKeywordIds(j.settings.favoriteKeywordIds);
        setProviders(j.settings.providers);
        setMaxCert(j.settings.maxCert);
        setThresholdCustom(j.settings.matchThreshold !== null);
        setThresholdCount(
          j.settings.matchThreshold !== null
            ? Math.max(MIN_MATCH_THRESHOLD, Math.min(n || MIN_MATCH_THRESHOLD, j.settings.matchThreshold))
            : groupMatchNeed(n, null)
        );
        setMediaFilter(j.settings.mediaFilter ?? "both");
      })
      .catch(() => {
        if (!cancelled) setError("Nätverksfel. Försök igen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, code]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const toggleLiked = (g: string) => {
    toggle(likedGenres, setLikedGenres, g);
    setDislikedGenres((prev) => prev.filter((v) => v !== g));
  };
  const toggleDisliked = (g: string) => {
    toggle(dislikedGenres, setDislikedGenres, g);
    setLikedGenres((prev) => prev.filter((v) => v !== g));
    // Genren lämnar Gillar-listan (unfoldet försvinner) — städa dess ev. valda
    // sub-genrer så inget osynligt keyword-filter hänger kvar (se GenrePicker).
    const staleIds = subgenresFor(g).flatMap((s) => s.keywordIds);
    if (staleIds.length) {
      setFavoriteKeywordIds((prev) => prev.filter((id) => !staleIds.includes(id)));
    }
  };
  const toggleFavoriteKeywordIds = (ids: number[]) => {
    setFavoriteKeywordIds((prev) => toggleKeywordGroup(prev, ids));
  };

  const canCustomizeThreshold = memberCount >= MIN_MATCH_THRESHOLD;
  const sliderMax = Math.max(MIN_MATCH_THRESHOLD, memberCount);
  const defaultNeed = groupMatchNeed(memberCount, null);
  const shownThreshold = Math.min(thresholdCount, sliderMax);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/group/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          code,
          favoriteGenres: likedGenres,
          dislikedGenres,
          favoriteKeywordIds,
          providers,
          maxCert,
          matchThreshold: thresholdCustom && canCustomizeThreshold ? shownThreshold : null,
          mediaFilter,
        }),
      });
      const j = (await res.json()) as SettingsResp;
      if (!res.ok || !j.ok) {
        setError(j.message ?? "Kunde inte spara.");
        return;
      }
      notify("Gruppinställningar sparade");
      // Ladda om gruppens kortlek så nya filter slår igenom direkt.
      void ensureGroupDeck(code, { force: true });
      onClose();
    } catch {
      setError("Nätverksfel. Försök igen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="group-settings-title">
      <div className="space-y-6 p-2">
        <div>
          <h3 id="group-settings-title" className="text-xl font-bold">
            Gruppinställningar
          </h3>
          <p className="mt-1 text-sm text-white/50">
            Tomma val = automatik utifrån medlemmarnas profiler.
          </p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-white/50">Laddar…</p>
        ) : (
          <>
            <div className="space-y-5">
              <SettingsSection
                title="Vi letar efter"
                hint="Alla i gruppen ser samma typ av titlar när ni swipar."
              >
                <SegmentedTabs
                  layoutId="group-settings-media"
                  tabs={[
                    { id: "both" as SwipeMediaFilter, label: "Båda" },
                    { id: "movie" as SwipeMediaFilter, label: "Film" },
                    { id: "tv" as SwipeMediaFilter, label: "Serier" },
                  ]}
                  value={mediaFilter}
                  onChange={setMediaFilter}
                />
              </SettingsSection>

              <SettingsSection title="Genrer">
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400/70">
                      Gillar
                    </p>
                    <GenrePicker
                      genres={GROUP_GENRES.map((g) => ({ id: g, label: g }))}
                      selectedGenreIds={likedGenres}
                      onToggleGenre={toggleLiked}
                      selectedKeywordIds={favoriteKeywordIds}
                      onToggleKeywordIds={toggleFavoriteKeywordIds}
                      tone="like"
                      wrap
                    />
                  </div>
                  <div className="h-px bg-white/5" />
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-rose-400/70">
                      Ogillar
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {GROUP_GENRES.map((g) => (
                        <Chip
                          key={`dis-${g}`}
                          tone="dislike"
                          selected={dislikedGenres.includes(g)}
                          onClick={() => toggleDisliked(g)}
                        >
                          {g}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection title="Streamingtjänster" hint="Tomt = alla tjänster som någon medlem har.">
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <Chip
                      key={p.key}
                      selected={providers.includes(p.label)}
                      onClick={() => toggle(providers, setProviders, p.label)}
                    >
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title="Åldersgräns">
                <div className="flex flex-wrap gap-2">
                  <Chip selected={maxCert === null} onClick={() => setMaxCert(null)}>
                    Auto (yngsta medlemmen)
                  </Chip>
                  {GROUP_CERTS.map((c) => (
                    <Chip key={c} selected={maxCert === c} onClick={() => setMaxCert(c)}>
                      {c === "0" ? "Barntillåten" : `${c} år`}
                    </Chip>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection
                title="Matchtröskel"
                hint="Hur många medlemmar som måste gilla samma titel för en match (minst 2)."
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Chip selected={!thresholdCustom} onClick={() => setThresholdCustom(false)}>
                      Standard ({defaultNeed} av {Math.max(memberCount, 1)})
                    </Chip>
                    <Chip
                      selected={thresholdCustom}
                      onClick={() => canCustomizeThreshold && setThresholdCustom(true)}
                      className={!canCustomizeThreshold ? "cursor-not-allowed opacity-40" : undefined}
                    >
                      Anpassad
                    </Chip>
                  </div>

                  {!canCustomizeThreshold && (
                    <p className="text-xs text-white/40">
                      Gruppen behöver minst 2 medlemmar för en anpassad tröskel.
                    </p>
                  )}

                  {thresholdCustom && canCustomizeThreshold && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="range"
                        min={MIN_MATCH_THRESHOLD}
                        max={sliderMax}
                        step={1}
                        value={shownThreshold}
                        onChange={(e) => setThresholdCount(Number(e.target.value))}
                        className="w-full accent-cyan-400"
                      />
                      <div className="flex items-center justify-between text-xs text-white/40">
                        <span>{MIN_MATCH_THRESHOLD}</span>
                        <span className="font-mono text-sm font-semibold text-cyan-300">
                          Matchning kräver: {shownThreshold} av {sliderMax} personer
                        </span>
                        <span>{sliderMax}</span>
                      </div>
                    </div>
                  )}
                </div>
              </SettingsSection>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose}>
                Avbryt
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? "Sparar…" : "Spara"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
