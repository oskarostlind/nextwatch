"use client";

// Delad genre-väljare: breda genre-chips (som idag) + ett tunt, inline
// UNFOLD av kurerade sub-genrer (TMDB keywords, se lib/subgenres.ts) direkt
// under en markerad genre. Multi-select på sub-genre-nivå (t.ex. Slasher +
// Zombie). Helt kontrollerad via props — ingen egen state — så samma
// implementation används av Discover, Watchlist (via MediaFilters) och
// Gruppinställningar utan att chip-stilen duplicerats tre gånger.
//
// Sub-genrer är OPTIONELLA: väljs ingen agerar den breda genren som förut.
// En genre utan kurerad uppdelning i lib/subgenres.ts visar helt enkelt
// inget unfold — det är avsiktligt, inte en bugg.
//
// TRI-STATE (Gruppinställningar): skickas `dislikedGenreIds` med aktiveras ett
// tredje läge per chip — gillar (grön) → ogillar (röd) → neutral — i EN grid
// i stället för två separata (en för Gillar, en för Ogillar). `onToggleGenre`
// och `onToggleDislikedGenre` är då bara "toggla medlemskap i respektive
// lista" — själva cykel-logiken (vilken lista som ska ändras för en given
// klick) och sub-genre-städningen när en genre lämnar "gillar" hålls här, en
// gång, i stället för dupliceras hos varje anropare.

import { Chip, cx } from "@/app/components/ui/kit";
import { SUBGENRES } from "@/lib/subgenres";

export type GenreOption = { id: string; label: string };
export type GenreChipTone = "default" | "like" | "dislike";

type Props = {
  genres: GenreOption[];
  selectedGenreIds: string[];
  onToggleGenre: (id: string) => void;
  selectedKeywordIds: number[];
  onToggleKeywordIds: (keywordIds: number[]) => void;
  /** Chip-ton för de BREDA genre-chipsen i enkelt (icke tri-state) läge. Sub-genre-chips är alltid cyan/teal enligt spec. */
  tone?: GenreChipTone;
  /** true = wrap:ande rad (Gruppinställningar), false (default) = horisontell scroll (Discover/Watchlist). */
  wrap?: boolean;
  className?: string;
  /** Satt = tri-state-läge (gillar/ogillar/neutral). Ogillade genre-id:n. */
  dislikedGenreIds?: string[];
  /** Krävs i tri-state-läge: togglar medlemskap i den ogillade listan. */
  onToggleDislikedGenre?: (id: string) => void;
};

export default function GenrePicker({
  genres,
  selectedGenreIds,
  onToggleGenre,
  selectedKeywordIds,
  onToggleKeywordIds,
  tone = "default",
  wrap = false,
  className,
  dislikedGenreIds,
  onToggleDislikedGenre,
}: Props) {
  const triState = dislikedGenreIds !== undefined;
  const selectedKw = new Set(selectedKeywordIds);
  const genreLabels = new Set(genres.map((g) => g.label));
  const unfolded = genres.filter(
    (g) => selectedGenreIds.includes(g.id) && (SUBGENRES[g.label]?.length ?? 0) > 0
  );

  function handleChipClick(g: GenreOption) {
    const wasLiked = selectedGenreIds.includes(g.id);
    // Lämnar chippen "gillar" (avmarkeras helt, eller går till "ogillar") —
    // städa dess ev. valda sub-genrer direkt, annars kan en osynlig
    // (ej längre visad) keyword-filtrering hänga kvar.
    if (wasLiked) {
      for (const sub of SUBGENRES[g.label] ?? []) {
        if (sub.keywordIds.every((id) => selectedKw.has(id))) {
          onToggleKeywordIds(sub.keywordIds);
        }
      }
    }

    if (!triState) {
      onToggleGenre(g.id);
      return;
    }
    if (wasLiked) {
      onToggleGenre(g.id); // ur "gillar"
      onToggleDislikedGenre?.(g.id); // in i "ogillar"
    } else if (dislikedGenreIds!.includes(g.id)) {
      onToggleDislikedGenre?.(g.id); // ur "ogillar" → neutral
    } else {
      onToggleGenre(g.id); // neutral → "gillar"
    }
  }

  return (
    <div className={cx("space-y-2", className)}>
      <div
        className={
          wrap
            ? "flex flex-wrap gap-2"
            : "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {genres.map((g) => {
          const liked = selectedGenreIds.includes(g.id);
          const disliked = triState && dislikedGenreIds!.includes(g.id);
          const chipTone: GenreChipTone = triState ? (liked ? "like" : disliked ? "dislike" : "default") : tone;
          return (
            <Chip
              key={g.id}
              tone={chipTone}
              selected={triState ? liked || disliked : liked}
              onClick={() => handleChipClick(g)}
              className={wrap ? undefined : "shrink-0 whitespace-nowrap"}
            >
              {g.label}
            </Chip>
          );
        })}
      </div>

      {unfolded.map((g) => (
        <div key={`sub-${g.id}`} className="flex flex-wrap gap-1.5 pl-1">
          {(SUBGENRES[g.label] ?? [])
            .filter((sub) => !genreLabels.has(sub.label))
            .map((sub) => {
              const isOn = sub.keywordIds.every((id) => selectedKw.has(id));
              return (
                <Chip
                  key={`${g.id}-${sub.label}`}
                  selected={isOn}
                  onClick={() => onToggleKeywordIds(sub.keywordIds)}
                  className="px-2.5 py-1 text-xs"
                >
                  {sub.label}
                </Chip>
              );
            })}
        </div>
      ))}
    </div>
  );
}
