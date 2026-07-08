"use client";

// Gruppinställningar (kugghjulet) — endast gruppens skapare kan spara.
// Tomma val = automatik: genrer/providers unionas från medlemmarnas profiler,
// åldersgräns från yngsta medlemmen, matchtröskel 60 %. Satta värden
// åsidosätter automatiken (se lib/unifiedRecs.ts + lib/groupSettings.ts).

import { useEffect, useState } from "react";
import Modal from "@/app/components/ui/Modal";
import { notify } from "@/app/components/lib/notify";
import { ensureGroupDeck } from "@/lib/swipeDeckStore";
import {
  DEFAULT_MATCH_THRESHOLD,
  GROUP_CERTS,
  GROUP_GENRES,
  type GroupCert,
  type GroupSettings,
} from "@/lib/groupSettings";
import { PROVIDERS } from "@/lib/providers";

type SettingsResp = {
  ok: boolean;
  message?: string;
  isCreator?: boolean;
  settings?: GroupSettings;
};

function Chip({
  selected,
  tone,
  onClick,
  children,
}: {
  selected: boolean;
  tone: "like" | "dislike" | "neutral";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const selectedCls =
    tone === "like"
      ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
      : tone === "dislike"
      ? "bg-rose-500/20 border-rose-400/50 text-rose-300"
      : "bg-cyan-500/20 border-cyan-400/50 text-cyan-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        selected ? selectedCls : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
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

  const [likedGenres, setLikedGenres] = useState<string[]>([]);
  const [dislikedGenres, setDislikedGenres] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [maxCert, setMaxCert] = useState<GroupCert | null>(null);
  const [threshold, setThreshold] = useState<number>(DEFAULT_MATCH_THRESHOLD);
  const [thresholdCustom, setThresholdCustom] = useState(false);

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
        setLikedGenres(j.settings.favoriteGenres);
        setDislikedGenres(j.settings.dislikedGenres);
        setProviders(j.settings.providers);
        setMaxCert(j.settings.maxCert);
        setThresholdCustom(j.settings.matchThreshold !== null);
        setThreshold(j.settings.matchThreshold ?? DEFAULT_MATCH_THRESHOLD);
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
  };

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
          providers,
          maxCert,
          matchThreshold: thresholdCustom ? threshold : null,
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
      <div className="space-y-5 p-2">
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
            <section>
              <h4 className="mb-2 text-sm font-semibold text-white/80">Gillade genrer</h4>
              <div className="flex flex-wrap gap-2">
                {GROUP_GENRES.map((g) => (
                  <Chip key={`like-${g}`} tone="like" selected={likedGenres.includes(g)} onClick={() => toggleLiked(g)}>
                    {g}
                  </Chip>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-white/80">Ogillade genrer</h4>
              <div className="flex flex-wrap gap-2">
                {GROUP_GENRES.map((g) => (
                  <Chip key={`dis-${g}`} tone="dislike" selected={dislikedGenres.includes(g)} onClick={() => toggleDisliked(g)}>
                    {g}
                  </Chip>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-white/80">Streamingtjänster</h4>
              <p className="mb-2 text-xs text-white/40">
                Tomt = alla tjänster som någon medlem har.
              </p>
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.map((p) => (
                  <Chip
                    key={p.key}
                    tone="neutral"
                    selected={providers.includes(p.label)}
                    onClick={() => toggle(providers, setProviders, p.label)}
                  >
                    {p.label}
                  </Chip>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-white/80">Åldersgräns</h4>
              <div className="flex flex-wrap gap-2">
                <Chip tone="neutral" selected={maxCert === null} onClick={() => setMaxCert(null)}>
                  Auto (yngsta medlemmen)
                </Chip>
                {GROUP_CERTS.map((c) => (
                  <Chip key={c} tone="neutral" selected={maxCert === c} onClick={() => setMaxCert(c)}>
                    {c === "0" ? "Barntillåten" : `${c} år`}
                  </Chip>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-white/80">Matchtröskel</h4>
              <p className="mb-2 text-xs text-white/40">
                Andel av gruppen som måste gilla samma titel för en match (minst 2 personer).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="neutral" selected={!thresholdCustom} onClick={() => setThresholdCustom(false)}>
                  Standard ({DEFAULT_MATCH_THRESHOLD} %)
                </Chip>
                <Chip tone="neutral" selected={thresholdCustom} onClick={() => setThresholdCustom(true)}>
                  Anpassad
                </Chip>
                {thresholdCustom && (
                  <div className="flex w-full items-center gap-3 pt-1">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <span className="w-12 shrink-0 text-right font-mono text-sm text-white/80">
                      {threshold} %
                    </span>
                  </div>
                )}
              </div>
            </section>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                {saving ? "Sparar…" : "Spara"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
