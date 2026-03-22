// app/onboarding/page_client.tsx
"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { sanitizeUsernameInput, usernameValidOrEmpty } from "@/lib/usernameClient";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

// --- Providers: basnamn → vi försöker .svg först, faller tillbaka till .svg.svg ---
const PROVIDER_BASENAME: Record<string, string> = {
  netflix: "netflix",
  "disney+": "disney-plus",
  disney: "disney-plus",
  "prime video": "prime-video",
  prime: "prime-video",
  max: "max",
  viaplay: "viaplay",
  "apple tv+": "apple-tv-plus",
  appletv: "apple-tv-plus",
  skyshowtime: "skyshowtime",
  "svt play": "svt-play",
  svt: "svt-play",
  "tv4 play": "tv4-play",
  tv4: "tv4-play",
};
function keyify(label: string) {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

function ProviderChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const key = keyify(label);
  const base = PROVIDER_BASENAME[key];
  const [src, setSrc] = useState<string | null>(
    base ? `/providers/${base}.svg` : null
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
        selected
          ? "border-cyan-400 bg-cyan-400/10"
          : "border-white/10 bg-white/5 hover:bg-white/10",
      ].join(" ")}
    >
      {src ? (
        <span className="relative inline-block h-5 w-5">
          <Image
            src={src}
            alt={label}
            fill
            sizes="20px"
            onError={() => {
              if (base) setSrc(`/providers/${base}.svg.svg`);
            }}
          />
        </span>
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded bg-white/20 text-[10px] font-bold">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

// ---------- typer ----------
type Fav = { id: number; title: string; year?: string; poster?: string | null };

// Liten hjälpare för att läsa cookie-värden client-side
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function SearchBox({
  label,
  placeholder,
  type, // "movie" | "tv"
  value,
  onSelect,
  locale = "sv-SE",
}: {
  label: string;
  placeholder: string;
  type: "movie" | "tv";
  value: Fav | null;
  onSelect: (v: Fav | null) => void;
  locale?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Fav[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const query = q.trim();
      if (value || query.length < 2) {
        setItems([]);
        return;
      }
      try {
        const url = `/api/tmdb/search?type=${type}&q=${encodeURIComponent(
          query
        )}&locale=${encodeURIComponent(locale)}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data: { ok?: boolean; results?: Fav[] } = await res.json();
        if (!active || !data?.ok) return;
        setItems(data.results ?? []);
        setOpen(true);
      } catch {
        // tyst
      }
    };
    const t = setTimeout(run, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, type, locale, value]);

  return (
    <div className="relative" ref={boxRef}>
      <label className="mb-1 block text-sm text-white/70">{label}</label>
      <div className="flex gap-2">
        <input
          className="mt-0 w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
          placeholder={placeholder}
          value={value ? value.title : q}
          onChange={(e) => {
            onSelect(null);
            setQ(e.target.value);
          }}
          onFocus={() => {
            if (items.length > 0) setOpen(true);
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-xl border border-white/10 px-3 hover:bg-white/10"
            title="Rensa"
          >
            ✕
          </button>
        )}
      </div>

      {open && items.length > 0 && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-black/70 backdrop-blur">
          {items.map((it) => (
            <button
              key={`${type}-${it.id}`}
              type="button"
              onClick={() => {
                onSelect(it);
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 p-2 text-left hover:bg-white/10"
            >
              <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded">
                <Image
                  src={
                    it.poster ??
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='40'/%3E"
                  }
                  alt={it.title}
                  width={28}
                  height={40}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {it.title} {it.year ? `(${it.year})` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- constants ----------
const LANGS = ["sv", "en"] as const;

const PROVIDERS = [
  "Netflix",
  "Disney+",
  "Prime Video",
  "Max",
  "Viaplay",
  "Apple TV+",
  "SkyShowtime",
  "SVT Play",
  "TV4 Play",
] as const;

const GENRES = [
  "Action",
  "Äventyr",
  "Animerat",
  "Komedi",
  "Kriminal",
  "Drama",
  "Fantasy",
  "Skräck",
  "Romantik",
  "Sci-Fi",
  "Thriller",
  "Dokumentär",
] as const;

export default function Client() {
  const router = useRouter();

  // state
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameBlockedChars, setUsernameBlockedChars] = useState(false);
  const [dob, setDob] = useState("");
  const [language, setLanguage] = useState<(typeof LANGS)[number]>("sv");
  const [providers, setProviders] = useState<string[]>([]);
  const [favoriteMovie, setFavoriteMovie] = useState<Fav | null>(null);
  const [favoriteShow, setFavoriteShow] = useState<Fav | null>(null);
  const [likeGenres, setLikeGenres] = useState<string[]>([]);
  const [dislikeGenres, setDislikeGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchLocale, setSearchLocale] = useState<string>("sv-SE");

  // Läs nw_locale från cookie (sätts av middleware) så TMDB-sök använder samma locale.
  useEffect(() => {
    const l = getCookie("nw_locale");
    if (l && /^[a-z]{2}(-[A-Z]{2})?$/.test(l)) setSearchLocale(l);
  }, []);

  function toggleProvider(p: string) {
    setProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }
  function toggleLike(g: string) {
    setLikeGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
    setDislikeGenres((prev) => prev.filter((x) => x !== g));
  }
  function onUsernameChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const lower = raw.toLowerCase();
    const next = sanitizeUsernameInput(raw);
    setUsername(next);
    setUsernameBlockedChars(lower.length > 0 && lower !== next);
  }

  function toggleDislike(g: string) {
    setDislikeGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
    setLikeGenres((prev) => prev.filter((x) => x !== g));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!usernameValidOrEmpty(username)) {
      setErr("Användarnamn måste vara tomt eller 3–20 tecken (a–z, 0–9, _, .).");
      return;
    }
    setLoading(true);

    // Region/Locale skickas inte – servern härleder från cookies/IP.
    const payload = {
      displayName,
      dob,
      uiLanguage: language,
      providers,
      favoriteMovie,
      favoriteShow,
      favoriteGenres: likeGenres,
      dislikedGenres: dislikeGenres,
    };

    try {
      const res = await fetch("/api/profile/save-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? "Ett fel uppstod.");
      }
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!data.ok) throw new Error(data.message ?? "Ett fel uppstod.");
      router.replace("/auth/register");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ett fel uppstod.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-3xl font-semibold">Onboarding</h1>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        {err && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-6">
          {/* Rad 1 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-white/70">
                Visningsnamn
              </label>
              <input
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
                placeholder="Ditt namn…"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/70">
                Födelsedatum
              </label>
              <input
                type="date"
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-white/70">Användarnamn (valfritt)</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/30 focus:bg-white/10"
              placeholder="t.ex. film_ninja.42"
              value={username}
              onChange={onUsernameChange}
              autoComplete="username"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-white/50">
              Tomt eller 3–20 tecken: a–z, 0–9, _ och . Används när vänner söker dig.
            </p>
            {usernameBlockedChars ? (
              <p className="mt-1 text-xs text-rose-400">Otillåtna tecken tas bort automatiskt.</p>
            ) : null}
          </div>

          {/* Rad 2 – ENDAST Språk kvar */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-white/70">Språk</label>
              <select
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value as (typeof LANGS)[number])
                }
              >
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Rad 3: favoritfilm/serie */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SearchBox
              label="Favoritfilm"
              placeholder="Sök titel…"
              type="movie"
              value={favoriteMovie}
              onSelect={setFavoriteMovie}
              locale={searchLocale}
            />
            <SearchBox
              label="Favoritserie"
              placeholder="Sök titel…"
              type="tv"
              value={favoriteShow}
              onSelect={setFavoriteShow}
              locale={searchLocale}
            />
          </div>

          {/* Providers */}
          <div>
            <div className="mb-2 text-sm text-white/70">Streaming­tjänster</div>
            <div className="flex flex-wrap gap-3">
              {PROVIDERS.map((p) => (
                <ProviderChip
                  key={p}
                  label={p}
                  selected={providers.includes(p)}
                  onToggle={() => toggleProvider(p)}
                />
              ))}
            </div>
          </div>

          {/* Genres */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm text-white/70">Gillar</div>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <button
                    key={`like-${g}`}
                    type="button"
                    onClick={() => toggleLike(g)}
                    className={[
                      "rounded-full px-3 py-1 text-sm border transition",
                      likeGenres.includes(g)
                        ? "border-emerald-400 bg-emerald-400/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm text-white/70">Ogillar</div>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <button
                    key={`dislike-${g}`}
                    type="button"
                    onClick={() => toggleDislike(g)}
                    className={[
                      "rounded-full px-3 py-1 text-sm border transition",
                      dislikeGenres.includes(g)
                        ? "border-rose-400 bg-rose-400/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Knappar */}
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="rounded-xl border border-white/10 px-4 py-2 hover:bg-white/10"
            >
              Tillbaka
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-white/15 px-4 py-2 font-medium hover:bg-white/25 disabled:opacity-50"
            >
              {loading ? "Sparar…" : "Spara & börja"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
