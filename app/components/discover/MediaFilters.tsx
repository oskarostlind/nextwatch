"use client";

import { SegmentedTabs } from "@/app/components/ui/kit";
import GenrePicker from "@/app/components/discover/GenrePicker";
import { useTranslations } from "next-intl";

export const MOVIE_GENRES = [
  ["28", "Action"], ["12", "Äventyr"], ["16", "Animerat"], ["35", "Komedi"],
  ["80", "Kriminal"], ["18", "Drama"], ["14", "Fantasy"], ["27", "Skräck"],
  ["10749", "Romantik"], ["878", "Sci-Fi"], ["53", "Thriller"],
] as const;

export const TV_GENRES = [
  ["10759", "Action & Äventyr"], ["16", "Animerat"], ["35", "Komedi"],
  ["80", "Kriminal"], ["18", "Drama"], ["10765", "Sci-Fi & Fantasy"],
  ["9648", "Mystik"], ["10768", "Krig & Politik"],
] as const;

/** Sortering för Discover (TMDB discover API). */
export const DISCOVER_SORT_OPTIONS = [
  { value: "popularity.desc", labelKey: "popular" },
  { value: "vote_average.desc", labelKey: "topRated" },
  { value: "primary_release_date.desc", labelKey: "newestMovie" },
  { value: "first_air_date.desc", labelKey: "newestTv" },
] as const;

/** Sortering för watchlist (klient-side på laddade items). */
export const WATCHLIST_SORT_OPTIONS = [
  { value: "addedAt", labelKey: "recentlyAdded" },
  { value: "popularity", labelKey: "popular" },
  { value: "voteAverage", labelKey: "topRated" },
  { value: "year", labelKey: "newest" },
] as const;

/** Sortering för Betyg-fliken. Betygsraderna saknar popularitet/röstsnitt,
 *  men bär användarens EGET betyg — det är den intressanta sorteringen här. */
export const RATED_SORT_OPTIONS = [
  { value: "userRating", labelKey: "topRated" },
  { value: "year", labelKey: "newest" },
  { value: "title", labelKey: "titleAz" },
] as const;

export type MediaTypeFilter = "movie" | "tv";

type Props = {
  type: MediaTypeFilter;
  onTypeChange: (t: MediaTypeFilter) => void;
  sort: string;
  onSortChange: (s: string) => void;
  genres: string[];
  onToggleGenre: (id: string) => void;
  /** Valda sub-genre TMDB keyword-id:n (inline-unfold under markerad genre). Tom lista = ingen sub-genre-filtrering. */
  keywordIds?: number[];
  onToggleKeywordIds?: (keywordIds: number[]) => void;
  /** discover = TMDB sort keys; watchlist/rated = client sort keys */
  mode?: "discover" | "watchlist" | "rated";
  layoutId?: string;
};

export default function MediaFilters({
  type,
  onTypeChange,
  sort,
  onSortChange,
  genres,
  onToggleGenre,
  keywordIds = [],
  onToggleKeywordIds,
  mode = "discover",
  layoutId = "media-filters-type",
}: Props) {
  const t = useTranslations("filters");
  const genreList = type === "movie" ? MOVIE_GENRES : TV_GENRES;
  const sortOptions =
    mode === "watchlist"
      ? WATCHLIST_SORT_OPTIONS
      : mode === "rated"
      ? RATED_SORT_OPTIONS
      : DISCOVER_SORT_OPTIONS.filter((o) => {
          if (type === "movie") return o.value !== "first_air_date.desc";
          return o.value !== "primary_release_date.desc";
        });

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SegmentedTabs
            layoutId={layoutId}
            tabs={[
              { id: "movie" as MediaTypeFilter, label: t("movies") },
              { id: "tv" as MediaTypeFilter, label: t("series") },
            ]}
            value={type}
            onChange={(t) => onTypeChange(t)}
          />
        </div>
        <select
          aria-label={t("sortAria")}
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-cyan-500/40"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`sort.${o.labelKey}`)}
            </option>
          ))}
        </select>
      </div>

      <GenrePicker
        genres={genreList.map(([id, name]) => ({ id, label: name }))}
        selectedGenreIds={genres}
        onToggleGenre={onToggleGenre}
        selectedKeywordIds={keywordIds}
        onToggleKeywordIds={onToggleKeywordIds ?? (() => {})}
      />
    </div>
  );
}
