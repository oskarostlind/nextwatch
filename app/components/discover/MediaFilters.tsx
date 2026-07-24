"use client";

import { Chip, SegmentedTabs } from "@/app/components/ui/kit";

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
  { value: "popularity.desc", label: "Populärast" },
  { value: "vote_average.desc", label: "Högst betyg" },
  { value: "primary_release_date.desc", label: "Nyast (film)" },
  { value: "first_air_date.desc", label: "Nyast (serie)" },
] as const;

/** Sortering för watchlist (klient-side på laddade items). */
export const WATCHLIST_SORT_OPTIONS = [
  { value: "addedAt", label: "Senast tillagd" },
  { value: "popularity", label: "Populärast" },
  { value: "voteAverage", label: "Högst betyg" },
  { value: "year", label: "Nyast" },
] as const;

/** Sortering för Betyg-fliken. Betygsraderna saknar popularitet/röstsnitt,
 *  men bär användarens EGET betyg — det är den intressanta sorteringen här. */
export const RATED_SORT_OPTIONS = [
  { value: "userRating", label: "Högst betyg" },
  { value: "year", label: "Nyast" },
  { value: "title", label: "Titel A–Ö" },
] as const;

export type MediaTypeFilter = "movie" | "tv";

type Props = {
  type: MediaTypeFilter;
  onTypeChange: (t: MediaTypeFilter) => void;
  sort: string;
  onSortChange: (s: string) => void;
  genres: string[];
  onToggleGenre: (id: string) => void;
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
  mode = "discover",
  layoutId = "media-filters-type",
}: Props) {
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
              { id: "movie" as MediaTypeFilter, label: "Film" },
              { id: "tv" as MediaTypeFilter, label: "Serier" },
            ]}
            value={type}
            onChange={(t) => onTypeChange(t)}
          />
        </div>
        <select
          aria-label="Sortera"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-cyan-500/40"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {genreList.map(([id, name]) => (
          <Chip
            key={id}
            selected={genres.includes(id)}
            onClick={() => onToggleGenre(id)}
            className="shrink-0 whitespace-nowrap"
          >
            {name}
          </Chip>
        ))}
      </div>
    </div>
  );
}
