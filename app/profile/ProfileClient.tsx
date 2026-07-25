// app/profile/ProfileClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import LogoutButton from "@/app/components/auth/LogoutButton";
import { ProviderChip } from "@/app/components/ui/ProviderChip";
import { Button, Card, PageHeader, SegmentedTabs, fieldClass, dateFieldClass } from "@/app/components/ui/kit";
import { sanitizeUsernameInput, usernameValidOrEmpty } from "@/lib/usernameClient";
import { AVATARS } from "@/lib/avatars";
import Avatar from "@/app/components/ui/Avatar";
import Modal from "@/app/components/ui/Modal";
import { openSubscriptionManagement } from "@/lib/premiumPurchase";
import { getBillingStatus } from "@/lib/billingStore";
import { clearClientCache } from "@/lib/clientCache";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { saveSwipeSettings } from "@/lib/swipeSettingsStore";
import { retrySoloDeck } from "@/lib/swipeDeckStore";
import CompactGenrePicker from "./CompactGenrePicker";
import GenreSuggestions from "./GenreSuggestions";
import TasteProfilePanel from "./TasteProfilePanel";
import { toSvGenres } from "./profileGenres";

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
  providers?: string[];
  favoriteMovie?: FavoriteItem | null;
  favoriteShow?: FavoriteItem | null;
};

const FIELD_CLASS = fieldClass;

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
  locale = "sv-SE",
}: {
  label: string;
  placeholder: string;
  type: "movie" | "tv";
  value: Fav;
  onSelect: (v: Fav) => void;
  locale?: string;
}) {
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
    const t = setTimeout(async () => {
      try {
        const u = `/api/tmdb/search?q=${encodeURIComponent(query)}&type=${type}&locale=${encodeURIComponent(locale)}`;
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
      clearTimeout(t);
    };
  }, [q, type, locale, value]);

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
            aria-label="Rensa"
            title="Rensa"
          >
            ✕
          </button>
        )}
      </div>

      {open && (loading || searched || items.length > 0) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-neutral-950/95 shadow-lg backdrop-blur">
          {loading ? (
            <div className="px-4 py-3 text-sm text-white/60">Söker…</div>
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
            <div className="px-4 py-3 text-sm text-white/60">Inga träffar — prova en annan sökning.</div>
          )}
        </div>
      )}
    </div>
  );
}

// —————————————————————— Huvudkomponent ——————————————————————
export default function ProfileClient({ initial }: Props) {
  const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? "");
  const [avatarId, setAvatarId] = useState<string | null>(initial?.avatarId ?? null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [username, setUsername] = useState<string>(initial?.username ?? "");
  const [usernameBlockedChars, setUsernameBlockedChars] = useState(false);
  const [dob, setDob] = useState<string>(toInputDate(initial?.dob ?? null));
  const [uiLanguage, setUiLanguage] = useState<string>(initial?.uiLanguage ?? "sv");

  const [favoriteGenres, setFavoriteGenres] = useState<string[]>(
    initial?.favoriteGenres ? toSvGenres(initial.favoriteGenres) : []
  );
  const [dislikedGenres, setDislikedGenres] = useState<string[]>(
    initial?.dislikedGenres ? toSvGenres(initial.dislikedGenres) : []
  );
  const [providers, setProviders] = useState<ProviderId[]>(
    initial?.providers ? toProviderIds(initial.providers) : []
  );
  const [favoriteMovie, setFavoriteMovie] = useState<Fav>(initial?.favoriteMovie ?? null);
  const [favoriteShow, setFavoriteShow] = useState<Fav>(initial?.favoriteShow ?? null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"bas" | "smak" | "tjanster" | "installningar">("bas");

  const TABS = [
    { id: "bas" as const, label: "Profil" },
    { id: "smak" as const, label: "Smak" },
    { id: "tjanster" as const, label: "Tjänster" },
    { id: "installningar" as const, label: "Inställningar" },
  ];

  // Bakåtkompatibel hydrering om initial saknar fält
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; profile?: Record<string, unknown> | null };
        if (!data.ok || !data.profile || ignore) return;
        const p = data.profile as Record<string, unknown>;
        if (Array.isArray(p.favoriteGenres)) setFavoriteGenres(toSvGenres(p.favoriteGenres));
        if (Array.isArray(p.dislikedGenres)) setDislikedGenres(toSvGenres(p.dislikedGenres));
        if (Array.isArray(p.providers)) setProviders(toProviderIds(p.providers));
        if (typeof p.uiLanguage === "string") setUiLanguage(p.uiLanguage);
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
      } catch { /* noop */ }
    })();
    return () => { ignore = true; };
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
      setMsg("Fyll i namn och födelsedatum. Användarnamn måste vara tomt eller 3–20 tecken (a–z, 0–9, _, .).");
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
          providers: providerIdsToLabels(providers),
          favoriteMovie,
          favoriteShow,
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || payload.ok === false) {
        setMsg(payload.error ?? "Kunde inte spara profil.");
        return;
      }
      const message = "Sparat.";

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
        setMsg(`${message} ${udata.message ?? "Kunde inte spara användarnamn."}`.trim());
        return;
      }

      setMsg(message);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Ett fel uppstod.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: "favoriteGenres" | "dislikedGenres" | "providers", value: string) => {
    if (key === "favoriteGenres") {
      setFavoriteGenres((old) => (old.includes(value) ? old.filter((v) => v !== value) : [...old, value]));
      setDislikedGenres((old) => old.filter((v) => v !== value));
    } else if (key === "dislikedGenres") {
      setDislikedGenres((old) => (old.includes(value) ? old.filter((v) => v !== value) : [...old, value]));
      setFavoriteGenres((old) => old.filter((v) => v !== value));
    } else {
      const id = value as ProviderId;
      setProviders((old) => (old.includes(id) ? old.filter((v) => v !== id) : [...old, id]));
    }
  };

  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow="Ditt konto" title="Profil" right={<LogoutButton />} />

      <div className="mb-6">
        <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} layoutId="profile-tabs" />
      </div>

      <Card className="overflow-hidden">
        {tab === "bas" && (
          <div className="grid gap-4">
            {/* Frivillig avatar ur förvalt bibliotek. Griden (16 st) tog för
                mycket plats inline — nu vald avatar + knapp som öppnar modal. */}
            <div className="min-w-0">
              <label className="mb-1 block text-sm text-white/70">Profilbild</label>
              <div className="flex items-center gap-4">
                <Avatar avatarId={avatarId} name={displayName} size={56} />
                <div className="grid gap-1">
                  <Button variant="secondary" onClick={() => setAvatarModalOpen(true)}>
                    {avatarId ? "Byt profilbild" : "Välj profilbild"}
                  </Button>
                  <p className="text-xs text-white/45">Frivilligt — syns hos vänner och i grupper.</p>
                </div>
              </div>
            </div>

            <Modal open={avatarModalOpen} onClose={() => setAvatarModalOpen(false)} labelledBy="avatar-picker-heading">
              <h3 id="avatar-picker-heading" className="mb-3 text-lg font-bold text-white">
                Välj profilbild
              </h3>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {AVATARS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.label}
                    aria-label={a.label}
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
                    <img src={`/avatars/${a.id}.svg`} alt={a.label} className="h-auto w-full" draggable={false} />
                  </button>
                ))}
              </div>
            </Modal>

            <div className="grid grid-cols-1 gap-4">
              <div className="min-w-0">
                <label className="mb-1 block text-sm text-white/70">Visningsnamn</label>
                <input
                  className={FIELD_CLASS}
                  placeholder="Ditt namn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="min-w-0 max-w-full overflow-hidden">
                <label className="mb-1 block text-sm text-white/70">Födelsedatum</label>
                <input
                  type="date"
                  className={dateFieldClass}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-sm text-white/70">Användarnamn</label>
              <input
                className={FIELD_CLASS}
                placeholder="t.ex. film_ninja.42"
                value={username}
                onChange={onUsernameChange}
                autoComplete="username"
                inputMode="text"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-white/50">
                3–20 tecken (a–z, 0–9, _, .) — visas för vänner.
              </p>
              {usernameBlockedChars ? (
                <p className="mt-1 text-xs text-rose-400">Otillåtna tecken tas bort.</p>
              ) : null}
              {!usernameValidOrEmpty(username) ? (
                <p className="mt-1 text-xs text-rose-400">Ange minst 3 tecken eller lämna tomt.</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/70">Språk</label>
              <div className="flex gap-2">
                {["sv", "en"].map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setUiLanguage(code)}
                    className={cx(
                      "rounded-xl border px-4 py-2 text-sm transition",
                      uiLanguage === code ? "border-cyan-400 bg-cyan-400/10 text-cyan-300" : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    {code === "sv" ? "Svenska" : "English"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "smak" && (
          <div className="grid gap-6">
            <TasteProfilePanel />

            <div className="border-t border-white/10 pt-5">
              <h3 className="mb-1 text-sm font-semibold text-white/85">Redigera smak</h3>
              <p className="mb-4 text-xs text-white/45">
                Dina val här påverkar både rekommendationer och smakprofilen ovan.
              </p>
              <div className="grid gap-5">
                <div className="grid grid-cols-1 gap-4">
                  <SearchBox label="Favoritfilm" placeholder="Sök film…" type="movie" value={favoriteMovie} onSelect={setFavoriteMovie} />
                  <SearchBox label="Favoritserie" placeholder="Sök serie…" type="tv" value={favoriteShow} onSelect={setFavoriteShow} />
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
                <CompactGenrePicker
                  label="Gillar"
                  tone="like"
                  selected={favoriteGenres}
                  excluded={dislikedGenres}
                  onChange={(next) => {
                    setFavoriteGenres(next);
                    setDislikedGenres((old) => old.filter((g) => !next.includes(g)));
                  }}
                />
                <CompactGenrePicker
                  label="Undviker"
                  tone="dislike"
                  selected={dislikedGenres}
                  excluded={favoriteGenres}
                  onChange={(next) => {
                    setDislikedGenres(next);
                    setFavoriteGenres((old) => old.filter((g) => !next.includes(g)));
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "tjanster" && (
          <div>
            <p className="mb-3 text-sm text-white/50">Välj de streamingtjänster du har.</p>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <ProviderChip
                  key={p.id}
                  label={p.label}
                  selected={providers.includes(p.id)}
                  onClick={() => toggle("providers", p.id)}
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
            {busy ? "Sparar…" : "Spara"}
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

const NOTIF_LABELS: { key: keyof NotifPrefs; label: string; hint: string }[] = [
  { key: "dailyRecs", label: "Dagens tips", hint: "En daglig film-/serierekommendation." },
  { key: "groupMatches", label: "Gruppmatchningar", hint: "När din grupp hittar en gemensam titel." },
  { key: "friendRequests", label: "Vänförfrågningar", hint: "Nya förfrågningar och accepterade vänner." },
  { key: "groupInvites", label: "Gruppinbjudningar", hint: "När någon bjuder in dig till en grupp." },
  { key: "shares", label: "Filmtips från vänner", hint: "När en vän skickar dig ett filmtips i chatten." },
  { key: "marketing", label: "Nyheter & erbjudanden", hint: "Enstaka uppdateringar om NextWatch." },
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
        setNote(j.message ?? "Kunde inte spara inställningen.");
      }
    } catch {
      setPrefs(prev);
      setNote("Nätverksfel.");
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
        setNote(j.message ?? "Kunde inte öppna prenumerationshanteringen.");
      }
    } catch {
      setNote("Nätverksfel.");
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
      setNote(j.message ?? "Kunde inte radera kontot.");
      setDeleteConfirm(false);
    } catch {
      setNote("Nätverksfel.");
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
        <h3 className="text-sm font-semibold text-white/80">Prenumeration</h3>
        {billing === null ? (
          <p className="text-sm text-white/50">Laddar…</p>
        ) : billing.isPremium ? (
          <div className="grid gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                {billing.plan === "lifetime" ? "Premium (lifetime)" : "Premium"}
              </span>
              {billing.status ? <span className="text-xs text-white/50">{billing.status}</span> : null}
            </div>
            <p className="text-sm text-white/60">
              Du har en annonsfri upplevelse.
              {billing.renewsAt
                ? ` Förnyas/upphör ${new Date(billing.renewsAt).toLocaleDateString("sv-SE")}.`
                : ""}
            </p>
            {billing.plan !== "lifetime" &&
              (billing.source === "apple" || ios ? (
                <div className="grid gap-2">
                  {ios && (
                    <Button variant="secondary" onClick={() => void openSubscriptionManagement()}>
                      Hantera i App Store
                    </Button>
                  )}
                  <p className="text-xs text-white/50">
                    Hantera eller säg upp din prenumeration via App Store: Inställningar → ditt namn →
                    Prenumerationer.
                  </p>
                </div>
              ) : (
                <Button variant="secondary" onClick={openStripePortal} disabled={portalBusy}>
                  {portalBusy ? "Öppnar…" : "Hantera prenumeration"}
                </Button>
              ))}
          </div>
        ) : (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/70">
              Du använder <span className="font-semibold">gratisversionen</span> med annonser.
            </p>
            <p className="text-sm text-white/50">Uppgradera till Premium (19 kr/mån) för en helt annonsfri upplevelse.</p>
            <a
              href="/premium"
              className="inline-flex w-fit items-center justify-center rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
            >
              Uppgradera till Premium
            </a>
          </div>
        )}
      </section>

      {/* Förslag — styr vad swipen visar. Film/serie-valet bor numera som en
          pill direkt på /swipe (där man ser effekten); här finns bara det som
          inte behöver vara ett svep bort. */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">Förslag</h3>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">Visa hyr- och köpalternativ</div>
            <div className="text-xs text-white/45">
              Av som standard. På visar vi även titlar du behöver betala extra för att se.
            </div>
          </div>
          <Toggle
            checked={swipeSettings.showPaidOptions}
            onChange={(v) => void saveSwipeSettings({ showPaidOptions: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/85">Visa barn- och familjeinnehåll</div>
            <div className="text-xs text-white/45">
              Av som standard. På tar med barnserier (t.ex. My Little Pony) i förslagen.
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
        <h3 className="text-sm font-semibold text-white/80">Notiser</h3>
        {prefs === null ? (
          <p className="text-sm text-white/50">Laddar…</p>
        ) : (
          <div className="grid gap-1">
            {NOTIF_LABELS.map(({ key, label, hint }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white/85">{label}</div>
                  <div className="text-xs text-white/45">{hint}</div>
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
          Push kräver att du tillåtit notiser för appen i systeminställningarna.
        </p>
      </section>

      {/* Radera konto — App Store-krav (Guideline 5.1.1(v)). */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-rose-300/80">Radera konto</h3>
        <div className="grid gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm text-white/70">
            Raderar ditt konto och all din data permanent: profil, betyg, watchlist,
            grupper och vänner. Det går inte att ångra.
          </p>
          {billing?.source === "apple" && (
            <p className="text-xs text-white/50">
              Har du en prenumeration via App Store? Säg upp den separat i Inställningar → ditt
              namn → Prenumerationer — att radera kontot här stänger inte av Apple-debiteringen.
            </p>
          )}
          {!deleteConfirm ? (
            <Button variant="secondary" onClick={() => setDeleteConfirm(true)}>
              Radera mitt konto
            </Button>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-rose-200">Är du helt säker?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void deleteAccount()}
                  disabled={deleting}
                  className="inline-flex items-center justify-center rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
                >
                  {deleting ? "Raderar…" : "Ja, radera permanent"}
                </button>
                <Button variant="secondary" onClick={() => setDeleteConfirm(false)} disabled={deleting}>
                  Avbryt
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Om — legal/support-länkarna Apple kräver + TMDB-attribution (TMDB:s villkor). */}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-white/80">Om NextWatch</h3>
        <div className="grid gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm">
          <a href="/legal/privacy" className="py-1.5 text-white/85 transition hover:text-white">
            Integritetspolicy
          </a>
          <a href="/legal/terms" className="py-1.5 text-white/85 transition hover:text-white">
            Användarvillkor
          </a>
          <a href="/support" className="py-1.5 text-white/85 transition hover:text-white">
            Support &amp; vanliga frågor
          </a>
          <a href="mailto:support@nextwatch.se" className="py-1.5 text-white/85 transition hover:text-white">
            Kontakta oss
          </a>
        </div>
        <p className="px-1 text-xs leading-relaxed text-white/40">
          Film- och seriedata från{" "}
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#01b4e4]"
          >
            TMDB
          </a>
          . Denna produkt använder TMDB:s API men är inte godkänd eller certifierad av TMDB.
        </p>
      </section>

      {note && <p className="text-sm text-rose-300">{note}</p>}
    </div>
  );
}
