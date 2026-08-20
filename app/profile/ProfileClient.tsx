// app/profile/ProfileClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import nextDynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES, bcp47, normalizeLocale, tmdbLanguage, type AppLocale } from "@/lib/i18nConfig";
import { setUiLanguage, writeUiLanguageCookie } from "@/lib/uiLanguage";
import LogoutButton from "@/app/components/auth/LogoutButton";
import { ProviderChip } from "@/app/components/ui/ProviderChip";
import { Button, Card, PageHeader, SegmentedTabs, fieldClass, dateFieldClass } from "@/app/components/ui/kit";
import { sanitizeUsernameInput, usernameValidOrEmpty } from "@/lib/usernameClient";
import { AVATARS } from "@/lib/avatars";
import Avatar from "@/app/components/ui/Avatar";
import { openSubscriptionManagement } from "@/lib/premiumPurchase";
import { getBillingStatus } from "@/lib/billingStore";
import { clearClientCache, getCached, removeCached, setCached } from "@/lib/clientCache";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { saveSwipeSettings } from "@/lib/swipeSettingsStore";
import { retrySoloDeck } from "@/lib/swipeDeckStore";
import { toSvGenres } from "./profileGenres";
import { GROUP_GENRES } from "@/lib/groupSettings";
import { toggleKeywordGroup } from "@/lib/subgenres";

// Kod-splittade paneler/modaler — laddas först när panelen/modalen öppnas
// (de renderas bakom flik-/modal-state), så förstamålningen slipper deras JS.
const Modal = nextDynamic(() => import("@/app/components/ui/Modal"), { ssr: false });
const GenreSuggestions = nextDynamic(() => import("./GenreSuggestions"), { ssr: false });
const TasteProfilePanel = nextDynamic(() => import("./TasteProfilePanel"), { ssr: false });
const GenrePicker = nextDynamic(() => import("@/app/components/discover/GenrePicker"), { ssr: false });

export type FavoriteItem = {
  id: number;
  title: string;
  year?: string | null;
  poster?: string | null;
};

// DTO exakt som servern skickar från app/profile/page.tsx
export type ProfileDTO = {
  displayName: string | null;
  /** Vald avatar ur lib/avatars.ts, null = ingen vald. */
  avatarId?: string | null;
  /** User.username */
  username?: string | null;
  dob: string | null;
  region: string | null;
  locale: string | null;
  uiLanguage: string | null;
  favoriteGenres: string[];
  dislikedGenres?: string[];
  favoriteKeywordIds?: number[];
  providers?: string[];
  favoriteMovie?: FavoriteItem | null;
  favoriteShow?: FavoriteItem | null;
};

const FIELD_CLASS = fieldClass;

// Klientcache för /api/profile-svaret — återbesök målar direkt ur cachen
// medan hämtningen revaliderar i bakgrunden (samma mönster som WL_CACHE_KEY).
// TTL:en är medvetet lång (30 dagar): mounten hämtar ALLTID färskt i bakgrunden
// oavsett cacheålder (se hydreringseffekten nedan), så TTL:en styr inte
// aktualitet — den är bara en yttre skyddsgräns mot en post som aldrig
// skrivs om (t.ex. kontot slutar besöka profilsidan). En kort TTL (tidigare
// 10 min) gjorde att nästan varje återbesök missade cachen helt — de allra
// flesta besök ligger längre isär än så — och profilen föll tillbaka till
// samma tomma-fält-väntan som utan cache.
const PROFILE_CACHE_KEY = "profile_v1";
const PROFILE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Props = { initial: ProfileDTO | null };
type Fav = FavoriteItem | null;

// —————————————————————— Providers ——————————————————————
const PROVIDERS = [
  { id: "netflix", label: "Netflix" },
  { id: "disney-plus", label: "Disney+" },
  { id: "prime-video", label: "Prime Video" },
  { id: "max", label: "Max" },
  { id: "viaplay", label: "Viaplay" },
  { id: "apple-tv-plus", label: "Apple TV+" },
  { id: "skyshowtime", label: "SkyShowtime" },
  { id: "svt-play", label: "SVT Play" },
  { id: "tv4-play", label: "TV4 Play" },
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];
const LABEL_TO_ID: Record<string, ProviderId> = (() => {
  const m: Record<string, ProviderId> = {};
  const put = (k: string, v: ProviderId) => (m[k.toLowerCase()] = v);
  for (const p of PROVIDERS) put(p.label, p.id);
  put("disney plus", "disney-plus");
  put("amazon prime video", "prime-video");
  put("prime", "prime-video");
  put("hbo max", "max");
  put("appletv+", "apple-tv-plus");
  put("apple tv plus", "apple-tv-plus");
  put("svt", "svt-play");
  put("tv4", "tv4-play");
  return m;
})();
function toProviderIds(jsonish: unknown): ProviderId[] {
  if (!Array.isArray(jsonish)) return [];
  const out = new Set<ProviderId>();
  for (const raw of jsonish) {
    const s = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
    if (!s) continue;
    const low = s.toLowerCase().trim();
    const id = (PROVIDERS as readonly { id: string }[]).some((p) => p.id === low)
      ? (low as ProviderId)
      : LABEL_TO_ID[low];
    if (id) out.add(id);
  }
  return Array.from(out);
}
function providerIdsToLabels(ids: ProviderId[]): string[] {
  const map = new Map(PROVIDERS.map((p) => [p.id, p.label] as const));
  return ids.map((id) => map.get(id)!).filter(Boolean);
}


// Genrer importeras från profileGenres.ts

function toInputDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function cx(...xs: Array<string | null | false | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// ——— Liten inline SearchBox (film/serie) ———
type SearchItem = { id: number; title: string; year?: string | null; poster?: string | null };
/** Matchar app/api/tmdb/search — returnerar `results`, inte `items`. */
type SearchRes = { ok?: boolean; results?: SearchItem[] };

function SearchBox({
  label,
  placeholder,
  type,
  value,
  onSelect,
  locale,
}: {
  label: string;
  placeholder: string;
  type: "movie" | "tv";
  value: Fav;
  onSelect: (v: Fav) => void;
  /** TMDB-språk. Utelämnat = följ gränssnittsspråket. */
  locale?: string;
}) {
  const t = useTranslations("profile");
  const uiLocale = useLocale();
  const searchLocale = locale ?? tmdbLanguage(uiLocale);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const query = q.trim();
    if (value) {
      setItems([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    if (query.length < 2) {
      setItems([]);
      setLoading(false);
      setSearched(false);
      setOpen(false);
      return;
    }
    setLoading(true);
    setSearched(false);
    const timer = setTimeout(async () => {
      try {
        const u = `/api/tmdb/search?q=${encodeURIComponent(query)}&type=${type}&locale=${encodeURIComponent(searchLocale)}`;
        const res = await fetch(u, { cache: "no-store" });
        if (!res.ok) {
          if (active) {
            setItems([]);
            setLoading(false);
            setSearched(true);
            setOpen(true);
          }
          return;
        }
        const data = (await res.json()) as SearchRes;
        if (!active) return;
        const list = Array.isArray(data.results) ? data.results : [];
        setItems(list);
        setLoading(false);
        setSearched(true);
        setOpen(true);
      } catch {
        if (active) {
          setItems([]);
          setLoading(false);
          setSearched(true);
        }
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, type, searchLocale, value]);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <label className="mb-1 block text-sm text-white/70">{label}</label>
      <div className="flex gap-2">
        <input
          className={FIELD_CLASS}
          placeholder={placeholder}
          value={value ? value.title : q}
          onChange={(e) => {
            onSelect(null);
            setQ(e.target.value);
          }}
          onFocus={() => {
            if (items.length > 0 || loading || searched) setOpen(true);
          }}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-black/30 px-3 text-sm hover:bg-white/5"
            onClick={() => {
              onSelect(null);
              setQ("");
              setItems([]);
              setOpen(false);
            }}
            aria-label={t("clear")}
            title={t("clear")}
          >
            ✕
          </button>
        )}
      </div>

      {open && (loading || searched || items.length > 0) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-neutral-950/95 shadow-lg backdrop-blur">
          {loading ? (
            <div className="px-4 py-3 text-sm text-white/60">{t("searching")}</div>
          ) : items.length > 0 ? (
            <ul className="max-h-64 overflow-auto">
              {items.map((it) => (
                <li key={`${type}-${it.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 p-2 text-left hover:bg-white/10"
                    onClick={() => {
                      onSelect({
                        id: it.id,
                        title: it.title,
                        year: it.year ?? null,
                        poster: it.poster ?? null,
                      });
                      setQ("");
                      setOpen(false);
                    }}
                  >
                    <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-white/10">
                      {it.poster ? (
                        <Image
                          src={it.poster}
                          alt=""
                          width={80}
                          height={120}
                          className="h-12 w-8 object-cover"
                        />
                      ) : (
                        <div className="h-12 w-8" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{it.title}</div>
                      {it.year ? <div className="text-xs text-white/60">{it.year}</div> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-white/60">{t("noSearchResults")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// —————————————————————— Huvudkomponent ——————————————————————
export default function ProfileClient({ initial }: Props) {
  const t = useTranslations("profile");
  const ta = useTranslations("avatars");
  const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? "");
  const [avatarId, setAvatarId] = useState<string | null>(initial?.avatarId ?? null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [username, setUsername] = useState<string>(initial?.username ?? "");
  const [usernameBlockedChars, setUsernameBlockedChars] = useState(false);
  const [dob, setDob] = useState<string>(toInputDate(initial?.dob ?? null));
  // Cookien är sanningen för vilket språk som RENDERAS just nu; profilfältet är
  // bara persisteringen av samma val. Startar vi från profilen i stället kan
  // knappen visa "Svenska" markerad medan appen redan talar engelska.
  const activeLocale = useLocale() as AppLocale;
  const [uiLanguage, setUiLanguageState] = useState<AppLocale>(activeLocale);
  const [langBusy, setLangBusy] = useState(false);
  const router = useRouter();
  const adoptedProfileLang = useRef(false);

  // Byter språk direkt: cookie → server components ritas om (router.refresh)
  // → profilen uppdateras i bakgrunden. Ingen "Spara" behövs, och inget
  // helsidesomladdning som hade slängt swipe-kortleken.
  const changeLanguage = async (next: AppLocale) => {
    if (next === uiLanguage || langBusy) return;
    setLangBusy(true);
    setUiLanguageState(next);
    try {
      await setUiLanguage(next);
      router.refresh();
    } finally {
      setLangBusy(false);
    }
  };

  const [favoriteGenres, setFavoriteGenres] = useState<string[]>(
    initial?.favoriteGenres ? toSvGenres(initial.favoriteGenres) : []
  );
  const [dislikedGenres, setDislikedGenres] = useState<string[]>(
    initial?.dislikedGenres ? toSvGenres(initial.dislikedGenres) : []
  );
  const [favoriteKeywordIds, setFavoriteKeywordIds] = useState<number[]>(
    initial?.favoriteKeywordIds ?? []
  );
  const [providers, setProviders] = useState<ProviderId[]>(
    initial?.providers ? toProviderIds(initial.providers) : []
  );
  const [favoriteMovie, setFavoriteMovie] = useState<Fav>(initial?.favoriteMovie ?? null);
  const [favoriteShow, setFavoriteShow] = useState<Fav>(initial?.favoriteShow ?? null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"bas" | "smak" | "tjanster" | "installningar">("bas");

  const [tasteSuggestBusy, setTasteSuggestBusy] = useState(false);
  const [tasteSuggestMsg, setTasteSuggestMsg] = useState<string | null>(null);

  const TABS = [
    { id: "bas" as const, label: t("tabProfile") },
    { id: "smak" as const, label: t("tabTaste") },
    { id: "tjanster" as const, label: t("tabServices") },
    { id: "installningar" as const, label: t("tabSettings") },
  ];

  // Bakåtkompatibel hydrering om initial saknar fält.
  // Klientcache (samma mönster som WatchlistClient): senaste /api/profile-svaret
  // ligger i localStorage så att återbesök målar direkt ur cachen medan
  // nätverkshämtningen revaliderar i bakgrunden.
  useEffect(() => {
    let ignore = false;

    const applyProfile = (p: Record<string, unknown>) => {
      if (Array.isArray(p.favoriteGenres)) setFavoriteGenres(toSvGenres(p.favoriteGenres));
      if (Array.isArray(p.dislikedGenres)) setDislikedGenres(toSvGenres(p.dislikedGenres));
      if (Array.isArray(p.favoriteKeywordIds)) {
        setFavoriteKeywordIds(p.favoriteKeywordIds.filter((id): id is number => typeof id === "number"));
      }
      if (Array.isArray(p.providers)) setProviders(toProviderIds(p.providers));
      // Kontots språk vinner över enhetens cookie EN gång vid hydrering: loggar
      // du in på en ny telefon ska appen byta till ditt sparade språk i stället
      // för att fastna på det webbläsaren råkade föreslå. adoptedProfileLang
      // gör det till en engångshändelse så refresh:en aldrig loopar.
      if (typeof p.uiLanguage === "string" && !adoptedProfileLang.current) {
        const fromProfile = normalizeLocale(p.uiLanguage);
        adoptedProfileLang.current = true;
        if (fromProfile !== activeLocale) {
          setUiLanguageState(fromProfile);
          writeUiLanguageCookie(fromProfile);
          router.refresh();
        }
      }
      if (typeof p.displayName === "string") setDisplayName(p.displayName);
      if (typeof p.avatarId === "string") setAvatarId(p.avatarId);
      else if (p.avatarId === null) setAvatarId(null);
      if (typeof p.username === "string") setUsername(p.username);
      else if (p.username === null) setUsername("");
      if (typeof p.dob === "string") setDob(toInputDate(p.dob));
      if (p.favoriteMovie && typeof p.favoriteMovie === "object") {
        const o = p.favoriteMovie as Record<string, unknown>;
        const id = typeof o.id === "number" ? o.id : null;
        const title = typeof o.title === "string" ? o.title : null;
        if (id && title) setFavoriteMovie({
          id, title,
          year: typeof o.year === "string" ? o.year : null,
          poster: typeof o.poster === "string" ? o.poster : null
        });
      }
      if (p.favoriteShow && typeof p.favoriteShow === "object") {
        const o = p.favoriteShow as Record<string, unknown>;
        const id = typeof o.id === "number" ? o.id : null;
        const title = typeof o.title === "string" ? o.title : null;
        if (id && title) setFavoriteShow({
          id, title,
          year: typeof o.year === "string" ? o.year : null,
          poster: typeof o.poster === "string" ? o.poster : null
        });
      }
    };

    // 1) Måla direkt ur cachen om den finns (stale-while-revalidate).
    const cached = getCached<Record<string, unknown>>(PROFILE_CACHE_KEY);
    if (cached) applyProfile(cached);

    // 2) Hämta färskt och revalidera i bakgrunden.
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (res.status === 401) {
          // Sessionen är ogiltig (utloggad/utgången) trots att sidan renderades —
          // om utloggningen inte hann tömma klientcachen (t.ex. serversidan
          // logout utan att LogoutButton kördes) ska den cachade profilen aldrig
          // visas för nästa person på samma enhet.
          if (!ignore) removeCached(PROFILE_CACHE_KEY);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; profile?: Record<string, unknown> | null };
        if (!data.ok || !data.profile || ignore) return;
        const p = data.profile as Record<string, unknown>;
        // Delad enhet-säkerhetsnät: om den cachade posten tillhörde en ANNAN
        // användare (userId skiljer sig från serverns svar) har vi redan hunnit
        // måla den för en bildruta — den kan vi inte ta tillbaka, men den ska
        // aldrig visas igen. applyProfile(p) nedan skriver ändå över allt synligt
        // med rätt kontos data.
        if (
          cached &&
          typeof cached.userId === "string" &&
          typeof p.userId === "string" &&
          cached.userId !== p.userId
        ) {
          removeCached(PROFILE_CACHE_KEY);
        }
        applyProfile(p);
        setCached(PROFILE_CACHE_KEY, p, PROFILE_CACHE_TTL_MS);
      } catch { /* noop */ }
    })();
    return () => { ignore = true; };
    // Körs medvetet EN gång vid mount. activeLocale/router läses bara i
    // engångsövertagandet av kontots språk (adoptedProfileLang), och att lägga
    // dem i deps skulle hämta om profilen vid varje språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = useMemo(
    () => !!displayName && !!dob && usernameValidOrEmpty(username),
    [displayName, dob, username]
  );

  function onUsernameChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const lower = raw.toLowerCase();
    const next = sanitizeUsernameInput(raw);
    setUsername(next);
    setUsernameBlockedChars(lower.length > 0 && lower !== next);
  }

  const submit = async () => {
    if (!canSubmit) {
      setMsg(t("validationRequired"));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          displayName,
          avatarId,
          dob,
          uiLanguage,
          favoriteGenres,
          dislikedGenres,
          favoriteKeywordIds,
          providers: providerIdsToLabels(providers),
          favoriteMovie,
          favoriteShow,
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        error?: string;
        profile?: Record<string, unknown>;
      };
      if (!res.ok || payload.ok === false) {
        setMsg(payload.error ?? t("saveProfileFailed"));
        return;
      }
      const message = t("savedDot");

      // Tjänster/genrer/favoriter påverkar rekommendationerna. Den cachade
      // solo-kortleken (24h TTL) byggdes med de GAMLA värdena, så den måste
      // slängas och hämtas om — annars låg t.ex. titlar för en nyss avmarkerad
      // tjänst kvar i swipe-flödet i upp till ett dygn (det var därför Disney+
      // dök upp fast tjänsten tagits bort). retrySoloDeck rensar cachen och
      // förladdar en färsk lek med de nya inställningarna.
      void retrySoloDeck();

      const unamePayload = username.trim() === "" ? null : username.trim();
      const ures = await fetch("/api/user/username/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ username: unamePayload } satisfies { username: string | null }),
      });
      const udata = (await ures.json()) as { ok?: boolean; message?: string };
      if (!ures.ok || udata.ok === false) {
        setMsg(`${message} ${udata.message ?? t("saveUsernameFailed")}`.trim());
        return;
      }

      // Skriv det färska svaret in i klientcachen nu när BÅDA sparningarna
      // (profil + username) har bekräftats av servern — annars visar nästa
      // besök (inom cache-TTL:en) de GAMLA värdena tills bakgrundshämtningen
      // i mount-effekten hunnit köra. /api/profile PUT svarar inte med
      // username (den bor på User och sparas separat ovan), så den läggs på
      // manuellt i stället för att falla bort ur cachen.
      if (payload.profile) {
        const existingCached = getCached<Record<string, unknown>>(PROFILE_CACHE_KEY) ?? {};
        setCached(
          PROFILE_CACHE_KEY,
          { ...existingCached, ...payload.profile, username: unamePayload },
          PROFILE_CACHE_TTL_MS
        );
      }

      setMsg(message);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleProvider = (value: string) => {
    const id = value as ProviderId;
    setProviders((old) => (old.includes(id) ? old.filter((v) => v !== id) : [...old, id]));
  };

  // Tri-state-cykeln (gillar → ogillar → neutral) och sub-genre-städningen
  // när en genre lämnar "gillar" hanteras av GenrePicker självt (samma
  // kontrakt som Gruppinställningar) — de här är bara "toggla medlemskap i
  // respektive lista", ett per läge.
  const toggleFavoriteGenreMembership = (g: string) =>
    setFavoriteGenres((old) => (old.includes(g) ? old.filter((v) => v !== g) : [...old, g]));
  const toggleDislikedGenreMembership = (g: string) =>
    setDislikedGenres((old) => (old.includes(g) ? old.filter((v) => v !== g) : [...old, g]));
  const toggleFavoriteKeywordIds = (ids: number[]) => {
    setFavoriteKeywordIds((prev) => toggleKeywordGroup(prev, ids));
  };

  // Auto-fyll ("Fyll i från mina betyg"): hämtar genrer/sub-genrer härledda ur
  // betygshistoriken och MERGAR in dem i nuvarande val — skriver aldrig över
  // manuella val, och användaren spar (eller inte) som vanligt efteråt.
  const applyTasteSuggestion = async () => {
    setTasteSuggestBusy(true);
    setTasteSuggestMsg(null);
    try {
      const res = await fetch("/api/profile/taste-suggestion", { cache: "no-store" });
      const data = (await res.json()) as
        | { ok: true; lowConfidence: boolean; genres: string[]; keywordIds: number[] }
        | { ok: false; message?: string };
      if (!res.ok || !data.ok) {
        setTasteSuggestMsg((!data.ok && data.message) || t("suggestFetchFailed"));
        return;
      }
      if (data.lowConfidence) {
        setTasteSuggestMsg(t("suggestNeedMore"));
        return;
      }
      if (data.genres.length === 0 && data.keywordIds.length === 0) {
        setTasteSuggestMsg(t("suggestNoPattern"));
        return;
      }
      const suggestedGenres = data.genres;
      setFavoriteGenres((old) => Array.from(new Set([...old, ...suggestedGenres])));
      setDislikedGenres((old) => old.filter((g) => !suggestedGenres.includes(g)));
      setFavoriteKeywordIds((old) => Array.from(new Set([...old, ...data.keywordIds])));
      setTasteSuggestMsg(t("suggestApplied"));
    } catch {
      setTasteSuggestMsg(t("networkError"));
    } finally {
      setTasteSuggestBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("tabProfile")} right={<LogoutButton />} />

      <div className="mb-6">
        <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} layoutId="profile-tabs" />
      </div>

      <Card className="overflow-hidden">
        {tab === "bas" && (
          <div className="grid gap-4">
            {/* Frivillig avatar ur förvalt bibliotek. Griden (16 st) tog för
                mycket plats inline — nu vald avatar + knapp som öppnar modal. */}
            <div className="min-w-0">
              <label className="mb-1 block text-sm text-white/70">{t("avatarLabel")}</label>
              <div className="flex items-center gap-4">
                <Avatar avatarId={avatarId} name={displayName} size={56} />
                <div className="grid gap-1">
                  <Button variant="secondary" onClick={() => setAvatarModalOpen(true)}>
                    {avatarId ? t("avatarChange") : t("avatarPick")}
                  </Button>
                  <p className="text-xs text-white/45">{t("avatarHint")}</p>
                </div>
              </div>
            </div>

            {/* Monteras först när den öppnas — Modal renderar ändå null när open=false,
                så beteendet är identiskt men den lat-laddade chunken hämtas inte i onödan. */}
            {avatarModalOpen && (
              <Modal open onClose={() => setAvatarModalOpen(false)} labelledBy="avatar-picker-heading">
                <h3 id="avatar-picker-heading" className="mb-3 text-lg font-bold text-white">
                  {t("avatarPick")}
                </h3>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {AVATARS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      title={ta(a.id)}
                      aria-label={ta(a.id)}
                      aria-pressed={avatarId === a.id}
                      onClick={() => {
                        // Klick på redan vald avmarkerar (null rensar valet vid spara).
                        setAvatarId((cur) => (cur === a.id ? null : a.id));
                        setAvatarModalOpen(false);
                      }}
                      className={`relative overflow-hidden rounded-xl border transition ${
                        avatarId === a.id
                          ? "border-cyan-400 ring-2 ring-cyan-400/60"
                          : "border-white/10 opacity-80 hover:border-white/30 hover:opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/avatars/${a.id}.svg`} alt={ta(a.id)} className="h-auto w-full" draggable={false} />
                    </button>
                  ))}
                </div>
              </Modal>
            )}

            <div className="grid grid-cols-1 gap-4">
              <div className="min-w-0">
                <label className="mb-1 block text-sm text-white/70">{t("displayNameLabel")}</label>
                <input
                  className={FIELD_CLASS}
                  placeholder={t("displayNamePlaceholder")}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="min-w-0 max-w-full overflow-hidden">
                <label className="mb-1 block text-sm text-white/70">{t("dobLabel")}</label>
                <input
                  type="date"
                  className={dateFieldClass}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-sm text-white/70">{t("usernameLabel")}</label>
              <input
                className={FIELD_CLASS}
                placeholder={t("usernamePlaceholder")}
                value={username}
                onChange={onUsernameChange}
                autoComplete="username"
                inputMode="text"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-white/50">
                {t("usernameHint")}
              </p>
              {usernameBlockedChars ? (
                <p className="mt-1 text-xs text-rose-400">{t("usernameBlockedChars")}</p>
              ) : null}
              {!usernameValidOrEmpty(username) ? (
                <p className="mt-1 text-xs text-rose-400">{t("usernameTooShort")}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/70">{t("languageLabel")}</label>
              <div className="flex gap-2">
                {LOCALES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => void changeLanguage(code)}
                    disabled={langBusy}
                    aria-pressed={uiLanguage === code}
                    className={cx(
                      "rounded-xl border px-4 py-2 text-sm transition disabled:opacity-60",
                      uiLanguage === code ? "border-cyan-400 bg-cyan-400/10 text-cyan-300" : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    {code === "sv" ? "Svenska" : "English"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-white/45">{t("languageInstantHint")}</p>
            </div>
          </div>
        )}

        {tab === "smak" && (
          <div className="grid gap-6">
            <TasteProfilePanel />

            <div className="border-t border-white/10 pt-5">
              <h3 className="mb-1 text-sm font-semibold text-white/85">{t("editTaste")}</h3>
              <p className="mb-4 text-xs text-white/45">
                {t("editTasteHint")}
              </p>
              <div className="grid gap-5">
                <div className="grid grid-cols-1 gap-4">
                  <SearchBox label={t("favoriteMovie")} placeholder={t("searchMovie")} type="movie" value={favoriteMovie} onSelect={setFavoriteMovie} />
                  <SearchBox label={t("favoriteShow")} placeholder={t("searchShow")} type="tv" value={favoriteShow} onSelect={setFavoriteShow} />
                </div>
                <GenreSuggestions
                  favoriteGenres={favoriteGenres}
                  dislikedGenres={dislikedGenres}
                  onAddLike={(g) => {
                    setFavoriteGenres((old) => (old.includes(g) ? old : [...old, g]));
                    setDislikedGenres((old) => old.filter((x) => x !== g));
                  }}
                  onRemoveDislike={(g) => setDislikedGenres((old) => old.filter((x) => x !== g))}
                />
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-sm text-white/70">{t("genres")}</label>
                    <button
                      type="button"
                      onClick={applyTasteSuggestion}
                      disabled={tasteSuggestBusy}
                      className="shrink-0 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tasteSuggestBusy ? t("analyzing") : t("fillFromRatings")}
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-white/40">
                    {t("fillFromRatingsHint")}
                  </p>
                  {tasteSuggestMsg && (
                    <p className="mb-2 text-xs text-cyan-200/80">{tasteSuggestMsg}</p>
                  )}
                  <GenrePicker
                    genres={GROUP_GENRES.map((g) => ({ id: g, label: g }))}
                    selectedGenreIds={favoriteGenres}
                    onToggleGenre={toggleFavoriteGenreMembership}
                    dislikedGenreIds={dislikedGenres}
                    onToggleDislikedGenre={toggleDislikedGenreMembership}
                    selectedKeywordIds={favoriteKeywordIds}
                    onToggleKeywordIds={toggleFavoriteKeywordIds}
                    wrap
                    subLayout="card"
                    emptyStateHint={t("genresEmptyHint")}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "tjanster" && (
          <div>
            <p className="mb-3 text-sm text-white/50">{t("providersHint")}</p>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <ProviderChip
                  key={p.id}
                  label={p.label}
                  selected={providers.includes(p.id)}
                  onClick={() => toggleProvider(p.id)}
                />
              ))}
            </div>
          </div>
        )}

        {tab === "installningar" && <SettingsTab />}
      </Card>

      {tab !== "installningar" && (
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={submit} disabled={busy || !canSubmit}>
            {busy ? t("saving") : t("save")}
          </Button>
          {msg && <p className="text-sm text-neutral-300">{msg}</p>}
        </div>
      )}
    </main>
  );
}

// —————————————————————— Inställningar ——————————————————————

type NotifPrefs = {
  dailyRecs: boolean;
  groupMatches: boolean;
  friendRequests: boolean;
  groupInvites: boolean;
  shares: boolean;
  marketing: boolean;
};

type BillingStatus = {
  plan: string;
  isPremium: boolean;
  source: "stripe" | "apple" | "lifetime" | null;
  status: string | null;
  renewsAt: string | null;
};

// Bara ordningen bor här — etikett och hjälptext hämtas ur messages/*.json
// under profile.notif.<key>.label / .hint när raden renderas.
const NOTIF_KEYS: (keyof NotifPrefs)[] = [
  "dailyRecs",
  "groupMatches",
  "friendRequests",
  "groupInvites",
  "shares",
  "marketing",
];

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
        checked ? "bg-cyan-500" : "bg-white/15",
        disabled ? "opacity-50" : "hover:opacity-90"
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 transform rounded-full bg-white transition",
          checked ? "translate-x-5" : "translate-x-1"
        )}
      />
    </button>
  );
}

function isNativeIOS(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
  try {
    return w.Capacitor?.getPlatform?.() === "ios" || w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function SettingsTab() {
  const t = useTranslations("profile");
  const locale = useLocale();
  const swipeSettings = useSwipeSettings();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [savingKey, setSavingKey] = useState<keyof NotifPrefs | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const [nRes, bj] = await Promise.all([
          fetch("/api/profile/notifications", { cache: "no-store" }),
          // Delad billing-store — men force: efter köp/återställning ska
          // profilen visa färsk status, inte sessionens cache.
          getBillingStatus(true),
        ]);
        if (nRes.ok) {
          const nj = (await nRes.json()) as { ok?: boolean; prefs?: NotifPrefs };
          if (!ignore && nj.ok && nj.prefs) setPrefs(nj.prefs);
        }
        if (bj && !ignore && bj.ok) {
          setBilling({
            plan: bj.plan,
            isPremium: bj.isPremium,
            source: bj.source,
            status: bj.status,
            renewsAt: bj.renewsAt,
          });
        }
      } catch {
        /* noop */
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  async function updatePref(key: keyof NotifPrefs, value: boolean) {
    if (!prefs) return;
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value }); // optimistiskt
    setSavingKey(key);
    setNote(null);
    try {
      const res = await fetch("/api/profile/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        setPrefs(prev); // rulla tillbaka
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setNote(j.message ?? t("savePrefFailed"));
      }
    } catch {
      setPrefs(prev);
      setNote(t("networkError"));
    } finally {
      setSavingKey(null);
    }
  }

  async function openStripePortal() {
    setPortalBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST", cache: "no-store" });
      const j = (await res.json()) as { ok?: boolean; url?: string; message?: string };
      if (j.ok && j.url) {
        window.location.href = j.url;
      } else {
        setNote(j.message ?? t("openPortalFailed"));
      }
    } catch {
      setNote(t("networkError"));
    } finally {
      setPortalBusy(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setNote(null);
    try {
      const res = await fetch("/api/user/delete", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && j.ok) {
        // Kontot och sessionen är borta — även den lokala cachen (kortlek,
        // watchlist, betyg) måste bort, annars ligger raderad data kvar på
        // enheten.
        clearClientCache();
        window.location.href = "/";
        return;
      }
      setNote(j.message ?? t("deleteAccountFailed"));
      setDeleteConfirm(false);
    } catch {
      setNote(t("networkError"));
      setDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  const ios = isNativeIOS();

  return (
    <div className="grid gap-8">
      {/* Prenumeration */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">{t("subscription")}</h3>
        {billing === null ? (
          <p className="text-sm text-white/50">{t("loading")}</p>
        ) : billing.isPremium ? (
          <div className="grid gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                {billing.plan === "lifetime" ? t("premiumLifetime") : "Premium"}
              </span>
              {billing.status ? <span className="text-xs text-white/50">{billing.status}</span> : null}
            </div>
            <p className="text-sm text-white/60">
              {t("adFreeExperience")}
              {billing.renewsAt
                ? ` ${t("renewsAt", {
                    date: new Date(billing.renewsAt).toLocaleDateString(bcp47(locale)),
                  })}`
                : ""}
            </p>
            {billing.plan !== "lifetime" &&
              (billing.source === "apple" || ios ? (
                <div className="grid gap-2">
                  {ios && (
                    <Button variant="secondary" onClick={() => void openSubscriptionManagement()}>
                      {t("manageInAppStore")}
                    </Button>
                  )}
                  <p className="text-xs text-white/50">
                    {t("manageAppleHint")}
                  </p>
                </div>
              ) : (
                <Button variant="secondary" onClick={openStripePortal} disabled={portalBusy}>
                  {portalBusy ? t("opening") : t("manageSubscription")}
                </Button>
              ))}
          </div>
        ) : (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/70">
              {t.rich("onFreePlan", {
                strong: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </p>
            <p className="text-sm text-white/50">{t("upgradeHint")}</p>
            <a
              href="/premium"
              className="inline-flex w-fit items-center justify-center rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
            >
              {t("upgradeCta")}
            </a>
          </div>
        )}
      </section>

      {/* Förslag — styr vad swipen visar. Film/serie-valet bor numera som en
          pill direkt på /swipe (där man ser effekten); här finns bara det som
          inte behöver vara ett svep bort. */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">{t("suggestions")}</h3>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("showPaidOptions")}</div>
            <div className="text-xs text-white/45">
              {t("showPaidOptionsHint")}
            </div>
          </div>
          <Toggle
            checked={swipeSettings.showPaidOptions}
            onChange={(v) => void saveSwipeSettings({ showPaidOptions: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("showKidsContent")}</div>
            <div className="text-xs text-white/45">
              {t("showKidsContentHint")}
            </div>
          </div>
          <Toggle
            checked={swipeSettings.showKidsContent}
            onChange={(v) => void saveSwipeSettings({ showKidsContent: v })}
          />
        </div>
      </section>

      {/* Notiser */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">{t("notifications")}</h3>
        {prefs === null ? (
          <p className="text-sm text-white/50">{t("loading")}</p>
        ) : (
          <div className="grid gap-1">
            {NOTIF_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white/85">{t(`notif.${key}.label`)}</div>
                  <div className="text-xs text-white/45">{t(`notif.${key}.hint`)}</div>
                </div>
                <Toggle
                  checked={prefs[key]}
                  disabled={savingKey === key}
                  onChange={(v) => void updatePref(key, v)}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-white/40">
          {t("pushHint")}
        </p>
      </section>

      {/* Radera konto — App Store-krav (Guideline 5.1.1(v)). */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-rose-300/80">{t("deleteAccount")}</h3>
        <div className="grid gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm text-white/70">
            {t("deleteAccountBody")}
          </p>
          {billing?.source === "apple" && (
            <p className="text-xs text-white/50">
              {t("deleteAccountAppleHint")}
            </p>
          )}
          {!deleteConfirm ? (
            <Button variant="secondary" onClick={() => setDeleteConfirm(true)}>
              {t("deleteAccountCta")}
            </Button>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-rose-200">{t("deleteAccountConfirm")}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void deleteAccount()}
                  disabled={deleting}
                  className="inline-flex items-center justify-center rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
                >
                  {deleting ? t("deleting") : t("deleteAccountYes")}
                </button>
                <Button variant="secondary" onClick={() => setDeleteConfirm(false)} disabled={deleting}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Genomgång — låter användaren titta på swipe-tutorialen igen på begäran. */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">{t("tours")}</h3>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("tourSwipe")}</div>
            <div className="text-xs text-white/45">
              {t("tourSwipeHint")}
            </div>
          </div>
          <Button variant="secondary" onClick={() => { window.location.href = "/swipe?tour=swipe-gestures"; }}>
            {t("showAgain")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("tourFriends")}</div>
            <div className="text-xs text-white/45">
              {t("tourFriendsHint")}
            </div>
          </div>
          <Button variant="secondary" onClick={() => { window.location.href = "/group?tour=friends-tour"; }}>
            {t("showAgain")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("tourGroups")}</div>
            <div className="text-xs text-white/45">
              {t("tourGroupsHint")}
            </div>
          </div>
          <Button variant="secondary" onClick={() => { window.location.href = "/group?tour=groups-tour"; }}>
            {t("showAgain")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">{t("tourWatchlist")}</div>
            <div className="text-xs text-white/45">
              {t("tourWatchlistHint")}
            </div>
          </div>
          <Button variant="secondary" onClick={() => { window.location.href = "/watchlist?tour=watchlist-tour"; }}>
            {t("showAgain")}
          </Button>
        </div>
      </section>

      {/* Om — legal/support-länkarna Apple kräver + TMDB-attribution (TMDB:s villkor). */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">{t("about")}</h3>
        <div className="grid gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm">
          <a href="/legal/privacy" className="py-1.5 text-white/85 transition hover:text-white">
            {t("privacyPolicy")}
          </a>
          <a href="/legal/terms" className="py-1.5 text-white/85 transition hover:text-white">
            {t("terms")}
          </a>
          <a href="/support" className="py-1.5 text-white/85 transition hover:text-white">
            {t("support")}
          </a>
          <a href="mailto:support@nextwatch.se" className="py-1.5 text-white/85 transition hover:text-white">
            {t("contact")}
          </a>
        </div>
        <p className="px-1 text-xs leading-relaxed text-white/40">
          {t.rich("tmdbAttribution", {
            tmdb: (chunks) => (
              <a
                href="https://www.themoviedb.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#01b4e4]"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>

      {note && <p className="text-sm text-rose-300">{note}</p>}
    </div>
  );
}
