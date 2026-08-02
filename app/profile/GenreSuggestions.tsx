"use client";

// Diskret förslag som jämför HÄRLEDDA genrer (ur faktiskt swipe-beteende,
// lib/tasteProfile.inferred.genres) mot vad användaren SJÄLV kryssat i. Ser
// algoritmen att du dras till en genre du inte gillar-markerat — eller rentav
// lagt i Undviker — föreslår den en justering.
//
// Premium-funktion: /api/profile/taste är premium-gejtad (samma som
// TasteProfilePanel). Fria konton får 403 → komponenten renderar inget.

import { useEffect, useState } from "react";
import { getCached, setCached } from "@/lib/clientCache";
import { ALL_GENRES_SV, ENG_TO_SV } from "./profileGenres";

/** Avfärdade förslag hålls borta i 30 dagar (per genre). */
const DISMISS_KEY = "genre_suggestions_dismissed";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Normaliserad vikt (topp = 1,00). 0,4 = ett tydligt, inte marginellt, mönster. */
const MIN_WEIGHT = 0.4;

type WeightedLabel = { id: number; name: string; weight: number };
type TasteResp = { ok?: boolean; inferred?: { genres?: WeightedLabel[] } };

type Suggestion = { kind: "add-like" | "remove-dislike"; genre: string };

/** TMDB-namnet kan vara svenskt (matchar redan) eller engelskt — normalisera
 *  till ALL_GENRES_SV, annars går det inte att föreslå (pickern kan inte visa det). */
function toSvGenre(name: string): string | null {
  const v = ENG_TO_SV[name] ?? name;
  return (ALL_GENRES_SV as readonly string[]).includes(v) ? v : null;
}

function readDismissed(): Set<string> {
  return new Set(getCached<string[]>(DISMISS_KEY) ?? []);
}

type Props = {
  favoriteGenres: string[];
  dislikedGenres: string[];
  onAddLike: (genre: string) => void;
  onRemoveDislike: (genre: string) => void;
};

export default function GenreSuggestions({
  favoriteGenres,
  dislikedGenres,
  onAddLike,
  onRemoveDislike,
}: Props) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  // Beräknas EN gång vid mount. Redigeringar triggar inte om — dels för att inte
  // hoppa runt medan man klickar, dels för att härledningen inte ändras av att
  // man kryssar i en ruta.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/profile/taste", { cache: "no-store" });
        if (!res.ok) return; // 403 (fri) eller fel → inga förslag
        const data = (await res.json()) as TasteResp;
        if (cancelled || !data.ok || !Array.isArray(data.inferred?.genres)) return;

        const dismissed = readDismissed();
        for (const g of data.inferred.genres) {
          if (g.weight < MIN_WEIGHT) break; // sorterade fallande — resten är svagare
          const sv = toSvGenre(g.name);
          if (!sv || dismissed.has(sv)) continue;
          if (dislikedGenres.includes(sv)) {
            setSuggestion({ kind: "remove-dislike", genre: sv });
            return;
          }
          if (!favoriteGenres.includes(sv)) {
            setSuggestion({ kind: "add-like", genre: sv });
            return;
          }
        }
      } catch {
        /* tyst — förslag är en bonus, aldrig kritiskt */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!suggestion) return null;

  const dismiss = () => {
    const cur = readDismissed();
    cur.add(suggestion.genre);
    setCached(DISMISS_KEY, [...cur], DISMISS_TTL_MS);
    setSuggestion(null);
  };

  const accept = () => {
    if (suggestion.kind === "add-like") onAddLike(suggestion.genre);
    else onRemoveDislike(suggestion.genre);
    dismiss();
  };

  const text =
    suggestion.kind === "add-like"
      ? `Du verkar dras till ${suggestion.genre}. Lägg till i Gillar?`
      : `Du verkar gilla ${suggestion.genre}, men den ligger i Undviker. Ta bort därifrån?`;

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] p-3">
      <p className="mb-2 text-sm text-cyan-50/90">{text}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={accept}
          className="rounded-lg bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-400"
        >
          Ja
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
        >
          Nej tack
        </button>
        <span className="ml-1 text-[11px] text-white/40">Spara för att bekräfta.</span>
      </div>
    </div>
  );
}
