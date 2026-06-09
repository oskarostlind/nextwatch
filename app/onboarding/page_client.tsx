// app/onboarding/page_client.tsx
"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { sanitizeUsernameInput, usernameValidRequired } from "@/lib/usernameClient";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ProviderChip } from "@/app/components/ui/ProviderChip";

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

const STEPS = [
  { id: 0, title: "Om dig", subtitle: "Namn, användarnamn och ålder" },
  { id: 1, title: "Tjänster", subtitle: "Språk och streaming" },
  { id: 2, title: "Smak", subtitle: "Favoriter och genrer" },
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

  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameBlockedChars, setUsernameBlockedChars] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [ageInput, setAgeInput] = useState("");

  function parsedAge(): number | null {
    const n = Number(ageInput.trim());
    if (!Number.isFinite(n)) return null;
    const age = Math.floor(n);
    if (age < 7 || age > 99) return null;
    return age;
  }
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
    setUsernameStatus("idle");
  }

  // Debounced tillgänglighetskoll för användarnamn
  useEffect(() => {
    if (!usernameValidRequired(username)) {
      setUsernameStatus(username.length > 0 ? "invalid" : "idle");
      return;
    }
    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/user/username/check?u=${encodeURIComponent(username)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { ok?: boolean; available?: boolean };
        if (!res.ok || !data.ok) {
          setUsernameStatus("invalid");
          return;
        }
        setUsernameStatus(data.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  function step0Valid() {
    return (
      displayName.trim().length > 0 &&
      parsedAge() !== null &&
      usernameValidRequired(username) &&
      usernameStatus === "available"
    );
  }

  function goNext() {
    setErr(null);
    if (step === 0 && !step0Valid()) {
      if (!usernameValidRequired(username)) {
        setErr("Användarnamn måste vara 3–20 tecken (a–z, 0–9, _, .).");
      } else if (usernameStatus === "taken") {
        setErr("Användarnamnet är upptaget. Välj ett annat.");
      } else if (usernameStatus === "checking") {
        setErr("Vänta medan vi kollar användarnamnet…");
      } else if (ageInput.trim() && parsedAge() === null) {
        setErr("Ange en giltig ålder (7–99 år).");
      } else {
        setErr("Fyll i alla obligatoriska fält.");
      }
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setErr(null);
    setStep((s) => Math.max(s - 1, 0));
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

    // Enter i formuläret får inte spara och hoppa över sista steget (Smak).
    if (step < STEPS.length - 1) {
      goNext();
      return;
    }

    if (!step0Valid()) {
      setErr("Kontrollera namn, användarnamn och ålder.");
      setStep(0);
      return;
    }
    setLoading(true);

    const payload = {
      displayName,
      username,
      age: parsedAge(),
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
      const data = (await res.json()) as { ok?: boolean; message?: string; next?: string };
      if (!data.ok) throw new Error(data.message ?? "Ett fel uppstod.");
      router.replace(data.next ?? "/auth/register");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ett fel uppstod.");
    } finally {
      setLoading(false);
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="mx-auto min-h-[100dvh] max-w-lg px-4 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/80">
          Välkommen till NextWatch
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{STEPS[step].title}</h1>
        <p className="mt-1 text-sm text-neutral-400">{STEPS[step].subtitle}</p>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="mb-2 flex justify-between text-xs text-neutral-500">
          {STEPS.map((s, i) => (
            <span key={s.id} className={i <= step ? "text-cyan-400" : ""}>
              {s.title}
            </span>
          ))}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-xl backdrop-blur sm:p-6">
        {err && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Steg 1: Om dig */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Visningsnamn</label>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-cyan-500/40"
                  placeholder="Ditt namn…"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Användarnamn <span className="text-cyan-400">*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
                    @
                  </span>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-8 pr-3 outline-none focus:ring-2 focus:ring-cyan-500/40"
                    placeholder="film_ninja.42"
                    value={username}
                    onChange={onUsernameChange}
                    autoComplete="username"
                    spellCheck={false}
                    required
                    minLength={3}
                    maxLength={20}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  3–20 tecken: a–z, 0–9, _ och . Vänner söker dig med detta namn.
                </p>
                {usernameBlockedChars ? (
                  <p className="mt-1 text-xs text-rose-400">Otillåtna tecken tas bort automatiskt.</p>
                ) : null}
                {usernameStatus === "checking" && (
                  <p className="mt-1 text-xs text-neutral-400">Kollar tillgänglighet…</p>
                )}
                {usernameStatus === "available" && (
                  <p className="mt-1 text-xs text-emerald-400">✓ Tillgängligt</p>
                )}
                {usernameStatus === "taken" && (
                  <p className="mt-1 text-xs text-rose-400">Upptaget – välj ett annat</p>
                )}
                {usernameStatus === "invalid" && username.length > 0 && (
                  <p className="mt-1 text-xs text-rose-400">Ogiltigt format</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Hur gammal är du? <span className="text-cyan-400">*</span>
                </label>
                <p className="mb-2 text-xs text-neutral-500">
                  Vi använder åldern för att filtrera innehåll efter åldersgräns.
                </p>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={7}
                    max={99}
                    className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-3 pr-12 outline-none focus:ring-2 focus:ring-cyan-500/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    placeholder="t.ex. 18"
                    value={ageInput}
                    onChange={(e) => setAgeInput(e.target.value.replace(/[^\d]/g, ""))}
                    required
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
                    år
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Steg 2: Tjänster */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Språk</label>
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-cyan-500/40"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as (typeof LANGS)[number])}
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {l === "sv" ? "Svenska" : "English"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 text-sm text-neutral-300">Dina streamingtjänster</div>
                <p className="mb-3 text-xs text-neutral-500">
                  Välj de tjänster du har – vi visar bara titlar du kan streama.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <ProviderChip
                      key={p}
                      label={p}
                      selected={providers.includes(p)}
                      onClick={() => toggleProvider(p)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Steg 3: Smak */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4">
                <SearchBox
                  label="Favoritfilm (valfritt)"
                  placeholder="Sök titel…"
                  type="movie"
                  value={favoriteMovie}
                  onSelect={setFavoriteMovie}
                  locale={searchLocale}
                />
                <SearchBox
                  label="Favoritserie (valfritt)"
                  placeholder="Sök titel…"
                  type="tv"
                  value={favoriteShow}
                  onSelect={setFavoriteShow}
                  locale={searchLocale}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm text-neutral-300">Gillar</div>
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map((g) => (
                      <button
                        key={`like-${g}`}
                        type="button"
                        onClick={() => toggleLike(g)}
                        className={[
                          "rounded-full border px-3 py-1 text-sm transition",
                          likeGenres.includes(g)
                            ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                            : "border-white/10 bg-white/5 hover:bg-white/10",
                        ].join(" ")}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm text-neutral-300">Ogillar</div>
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map((g) => (
                      <button
                        key={`dislike-${g}`}
                        type="button"
                        onClick={() => toggleDislike(g)}
                        className={[
                          "rounded-full border px-3 py-1 text-sm transition",
                          dislikeGenres.includes(g)
                            ? "border-rose-400 bg-rose-400/10 text-rose-300"
                            : "border-white/10 bg-white/5 hover:bg-white/10",
                        ].join(" ")}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            {step === 0 ? (
              <Link href="/" className="text-sm text-neutral-400 underline hover:text-neutral-200">
                Tillbaka
              </Link>
            ) : (
              <button
                type="button"
                onClick={goBack}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-white/10"
              >
                ← Föregående
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-medium text-black hover:bg-cyan-400"
              >
                Nästa →
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Sparar…" : "Spara & börja"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
