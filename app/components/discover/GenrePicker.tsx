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
  /** Chip-ton för de BREDA genre-chipsen (grupp Gillar/Ogillar använder like/dislike). Sub-genre-chips är alltid cyan/teal enligt spec. */
  tone?: GenreChipTone;
  /** true = wrap:ande rad (Gruppinställningar), false (default) = horisontell scroll (Discover/Watchlist). */
  wrap?: boolean;
  className?: string;
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
}: Props) {
  const selectedKw = new Set(selectedKeywordIds);
  const unfolded = genres.filter(
    (g) => selectedGenreIds.includes(g.id) && (SUBGENRES[g.label]?.length ?? 0) > 0
  );

  // Avmarkeras en bred genre städas dess ev. valda sub-genrer bort direkt —
  // annars kan en osynlig (ej längre visad) keyword-filtrering hänga kvar.
  function handleToggleGenre(g: GenreOption) {
    if (selectedGenreIds.includes(g.id)) {
      for (const sub of SUBGENRES[g.label] ?? []) {
        if (sub.keywordIds.every((id) => selectedKw.has(id))) {
          onToggleKeywordIds(sub.keywordIds);
        }
      }
    }
    onToggleGenre(g.id);
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
        {genres.map((g) => (
          <Chip
            key={g.id}
            tone={tone}
            selected={selectedGenreIds.includes(g.id)}
            onClick={() => handleToggleGenre(g)}
            className={wrap ? undefined : "shrink-0 whitespace-nowrap"}
          >
            {g.label}
          </Chip>
        ))}
      </div>

      {unfolded.map((g) => (
        <div key={`sub-${g.id}`} className="flex flex-wrap gap-1.5 pl-1">
          {(SUBGENRES[g.label] ?? []).map((sub) => {
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
