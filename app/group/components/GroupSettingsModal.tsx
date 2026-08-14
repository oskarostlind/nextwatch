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
import { ProviderChip } from "@/app/components/ui/ProviderChip";
import { PROVIDERS } from "@/lib/providers";
import { toggleKeywordGroup } from "@/lib/subgenres";
import { useTranslations } from "next-intl";

type SettingsResp = {
  ok: boolean;
  message?: string;
  isCreator?: boolean;
  settings?: GroupSettings;
  memberCount?: number;
  capacity?: { max: number; limitedByFreePlan: boolean; premiumMax: number };
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
  const t = useTranslations("groupSettings");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memberCount, setMemberCount] = useState(0);
  const [capacity, setCapacity] = useState<SettingsResp["capacity"]>(undefined);
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
          setError(j.message ?? t("loadFailed"));
          return;
        }
        const n = j.memberCount ?? 0;
        setMemberCount(n);
        setCapacity(j.capacity);
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
        if (!cancelled) setError(t("networkError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  // Tri-state-cykeln (gillar → ogillar → neutral) och sub-genre-städningen
  // när en genre lämnar "gillar" hanteras av GenrePicker självt — de här är
  // bara "toggla medlemskap i respektive lista", ett per läge.
  const toggleLikedMembership = (g: string) => toggle(likedGenres, setLikedGenres, g);
  const toggleDislikedMembership = (g: string) => toggle(dislikedGenres, setDislikedGenres, g);
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
      notify(t("saved"));
      // Ladda om gruppens kortlek så nya filter slår igenom direkt.
      void ensureGroupDeck(code, { force: true });
      onClose();
    } catch {
      setError(t("networkError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="group-settings-title">
      <div className="space-y-6 p-2">
        <div>
          <h3 id="group-settings-title" className="text-xl font-bold">
            {t("heading")}
          </h3>
          <p className="mt-1 text-sm text-white/50">
            {t("headingHint")}
          </p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-white/50">{t("loading")}</p>
        ) : (
          <>
            <div className="space-y-5">
              {capacity && (
                <SettingsSection title={t("seats")}>
                  <p className="text-sm text-white/70">
                    {t("seatsUsed", { used: memberCount, max: capacity.max })}
                  </p>
                  {capacity.limitedByFreePlan && (
                    <p className="mt-1.5 text-xs leading-relaxed text-white/40">
                      {t("seatsPremiumHint", { max: capacity.premiumMax })}
                    </p>
                  )}
                </SettingsSection>
              )}

              <SettingsSection
                title={t("lookingFor")}
                hint={t("lookingForHint")}
              >
                <SegmentedTabs
                  layoutId="group-settings-media"
                  tabs={[
                    { id: "both" as SwipeMediaFilter, label: t("filterBoth") },
                    { id: "movie" as SwipeMediaFilter, label: t("filterMovie") },
                    { id: "tv" as SwipeMediaFilter, label: t("filterTv") },
                  ]}
                  value={mediaFilter}
                  onChange={setMediaFilter}
                />
              </SettingsSection>

              <SettingsSection
                title={t("genres")}
                hint={t("genresHint")}
              >
                <GenrePicker
                  genres={GROUP_GENRES.map((g) => ({ id: g, label: g }))}
                  selectedGenreIds={likedGenres}
                  onToggleGenre={toggleLikedMembership}
                  dislikedGenreIds={dislikedGenres}
                  onToggleDislikedGenre={toggleDislikedMembership}
                  selectedKeywordIds={favoriteKeywordIds}
                  onToggleKeywordIds={toggleFavoriteKeywordIds}
                  wrap
                  subLayout="card"
                />
              </SettingsSection>

              <SettingsSection title={t("providers")} hint={t("providersHint")}>
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <ProviderChip
                      key={p.key}
                      label={p.label}
                      selected={providers.includes(p.label)}
                      onClick={() => toggle(providers, setProviders, p.label)}
                    />
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t("ageLimit")}>
                <div className="flex flex-wrap gap-2">
                  <Chip selected={maxCert === null} onClick={() => setMaxCert(null)}>
                    {t("ageAuto")}
                  </Chip>
                  {GROUP_CERTS.map((c) => (
                    <Chip key={c} selected={maxCert === c} onClick={() => setMaxCert(c)}>
                      {c === "0" ? t("ageAllAges") : t("ageYears", { years: c })}
                    </Chip>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection
                title={t("threshold")}
                hint={t("thresholdHint")}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Chip selected={!thresholdCustom} onClick={() => setThresholdCustom(false)}>
                      {t("thresholdDefault", { need: defaultNeed, of: Math.max(memberCount, 1) })}
                    </Chip>
                    <Chip
                      selected={thresholdCustom}
                      onClick={() => canCustomizeThreshold && setThresholdCustom(true)}
                      className={!canCustomizeThreshold ? "cursor-not-allowed opacity-40" : undefined}
                    >
                      {t("thresholdCustom")}
                    </Chip>
                  </div>

                  {!canCustomizeThreshold && (
                    <p className="text-xs text-white/40">
                      {t("thresholdNeedsTwo")}
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
                          {t("thresholdValue", { need: shownThreshold, of: sliderMax })}
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
                {t("cancel")}
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
