"use client";

// Användarprofil i admin-vyn: helskärmsark på mobil, sidopanel på desktop.
// Laddar /api/admin/users/[id] och visar konto, smak, aktivitet och senaste
// swipes. "Lägg till vän" går via den vanliga /api/friends/request — du är
// inloggad som dig själv, så det blir en helt vanlig vänförfrågan (med push).

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/app/components/ui/Avatar";

type Relation = "self" | "friends" | "outgoing" | "incoming" | "blocked" | "none";

type Detail = {
  relation: Relation;
  user: {
    id: string;
    email: string | null;
    username: string | null;
    displayName: string | null;
    avatarId: string | null;
    plan: string;
    planSince: string | null;
    subProvider: string | null;
    subStatus: string | null;
    subCurrentPeriodEnd: string | null;
    verified: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    lastActiveAt: string | null;
    loginMethods: string[];
    termsAccepted: boolean;
    hasProfile: boolean;
    age: number | null;
    uiLanguage: string | null;
    region: string | null;
    providers: string[];
    favoriteGenres: string[];
    dislikedGenres: string[];
    favoriteMovie: string | null;
    favoriteShow: string | null;
    swipeMediaFilter: string | null;
    showKidsContent: boolean | null;
    notifyDailyRecs: boolean | null;
    pushDevices: number;
  };
  counts: {
    ratings: number;
    watchlist: number;
    groups: number;
    friends: number;
    purchases: number;
    decisions: Record<string, number>;
  };
  recent: {
    tmdbId: number;
    mediaType: string;
    decision: string;
    rating: number | null;
    decidedAt: string;
    title: string;
    year: number | null;
    poster: string | null;
  }[];
  groups: { code: string; joinedAt: string; members: number }[];
};

function ago(iso: string | null): string {
  if (!iso) return "aldrig";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "nyss";
  if (s < 3600) return `${Math.round(s / 60)} min sedan`;
  if (s < 86400) return `${Math.round(s / 3600)} h sedan`;
  const d = Math.round(s / 86400);
  if (d < 45) return `${d} d sedan`;
  return new Date(iso).toLocaleDateString("sv-SE");
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("sv-SE") : "—";
}

const DECISION_LABEL: Record<string, { label: string; cls: string }> = {
  like: { label: "Gillade", cls: "bg-emerald-500/15 text-emerald-300" },
  dislike: { label: "Nej", cls: "bg-rose-500/15 text-rose-300" },
  seen: { label: "Sett", cls: "bg-sky-500/15 text-sky-300" },
  RATED: { label: "Betyg", cls: "bg-amber-500/15 text-amber-300" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-white/45">{label}</span>
      <span className="min-w-0 text-right text-white/85">{children}</span>
    </div>
  );
}

function Tags({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "good" | "bad" }) {
  if (items.length === 0) return <span className="text-white/35">—</span>;
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200"
      : tone === "bad"
        ? "bg-rose-500/10 text-rose-200"
        : "bg-white/[0.07] text-white/75";
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {items.map((t) => (
        <span key={t} className={`rounded-md px-1.5 py-0.5 text-xs ${cls}`}>
          {t}
        </span>
      ))}
    </span>
  );
}

export default function UserSheet({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  /** Anropas efter plan-/raderingsåtgärd så listan kan laddas om. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) setData(j as Detail);
        else setError(j?.message ?? "Kunde inte ladda användaren.");
      })
      .catch(() => setError("Nätverksfel."));
  }, [userId]);

  useEffect(() => {
    setData(null);
    setNote(null);
    setConfirmDelete(false);
    load();
  }, [load]);

  // Esc stänger; bakgrunden scrollar inte medan arket är öppet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function addFriend() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: userId }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; requestId?: string };
      if (j.ok) {
        setNote(j.requestId === "already_friends" ? "Ni är redan vänner." : "Vänförfrågan skickad.");
        load();
      } else setNote(j.message ?? "Kunde inte skicka förfrågan.");
    } catch {
      setNote("Nätverksfel.");
    } finally {
      setBusy(false);
    }
  }

  async function adminAction(body: Record<string, string>) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/users/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ userId, ...body }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string };
      setNote(j.message ?? (j.ok ? "Klart." : "Misslyckades."));
      onChanged();
      if (body.action === "delete" && j.ok) onClose();
      else load();
    } catch {
      setNote("Nätverksfel.");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const u = data?.user;
  const name = u ? u.displayName ?? u.username ?? u.email ?? "Namnlös" : "";
  const dec = data?.counts.decisions ?? {};
  const likeShare =
    data && data.counts.ratings > 0 ? Math.round(((dec.like ?? 0) / data.counts.ratings) * 100) : null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label="Användarprofil">
      <button type="button" aria-label="Stäng" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative flex h-full w-full flex-col bg-neutral-950 sm:max-w-md sm:border-l sm:border-white/10">
        {/* Sticky topprad — stäng alltid inom räckhåll för tummen. */}
        <div
          className="flex items-center gap-3 border-b border-white/10 px-4 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
            aria-label="Tillbaka"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="truncate text-sm font-semibold text-white/80">Användare</span>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-5">
          {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          {!data && !error && (
            <div className="space-y-3">
              <div className="h-20 animate-pulse rounded-2xl bg-white/5" />
              <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
            </div>
          )}

          {data && u && (
            <>
              {/* Huvud */}
              <div className="flex items-center gap-4">
                <Avatar avatarId={u.avatarId} name={name} size={64} />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-white">{name}</h2>
                  <p className="truncate text-sm text-white/45">
                    {u.username ? `@${u.username}` : "inget användarnamn"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        u.plan === "free" ? "bg-white/10 text-white/60" : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {u.plan}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        u.verified ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {u.verified ? "verifierad" : "overifierad"}
                    </span>
                    {!u.hasProfile && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
                        ej onboardad
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Lägg till vän */}
              <div className="mt-5">
                {data.relation === "self" ? (
                  <p className="rounded-xl bg-white/5 px-3 py-2.5 text-center text-sm text-white/50">Det här är du.</p>
                ) : data.relation === "friends" ? (
                  <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-center text-sm font-medium text-emerald-200">
                    ✓ Ni är vänner
                  </p>
                ) : data.relation === "outgoing" ? (
                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center text-sm text-white/60">
                    Vänförfrågan skickad — väntar på svar
                  </p>
                ) : data.relation === "blocked" ? (
                  <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-center text-sm text-rose-200">
                    Blockerad — kan inte lägga till
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void addFriend()}
                    className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {data.relation === "incoming" ? "Acceptera vänförfrågan" : "Lägg till som vän"}
                  </button>
                )}
                {note && <p className="mt-2 text-center text-sm text-cyan-200">{note}</p>}
              </div>

              {/* Aktivitet */}
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { l: "Swipes", v: data.counts.ratings },
                  { l: "Bevakar", v: data.counts.watchlist },
                  { l: "Vänner", v: data.counts.friends },
                  { l: "Gillar", v: likeShare != null ? `${likeShare} %` : "—" },
                  { l: "Grupper", v: data.counts.groups },
                  { l: "Köp", v: data.counts.purchases },
                ].map((s) => (
                  <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <div className="text-lg font-bold tabular-nums text-white">{s.v}</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/40">{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Konto */}
              <h3 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Konto</h3>
              <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                <Row label="E-post">
                  <span className="break-all">{u.email ?? "—"}</span>
                </Row>
                <Row label="Inloggning">{u.loginMethods.join(" + ") || "—"}</Row>
                <Row label="Registrerad">{fmtDate(u.createdAt)}</Row>
                <Row label="Senast aktiv">{ago(u.lastActiveAt)}</Row>
                <Row label="Senast inloggad">{ago(u.lastLoginAt)}</Row>
                {u.plan !== "free" && (
                  <Row label="Prenumeration">
                    {[u.subProvider, u.subStatus].filter(Boolean).join(" · ") || "—"}
                    {u.subCurrentPeriodEnd && (
                      <span className="block text-xs text-white/40">förnyas {fmtDate(u.subCurrentPeriodEnd)}</span>
                    )}
                  </Row>
                )}
                <Row label="Push-enheter">{u.pushDevices}</Row>
                <Row label="Villkor godkända">{u.termsAccepted ? "Ja" : "Nej"}</Row>
                <Row label="User-id">
                  <code className="break-all text-[11px] text-white/50">{u.id}</code>
                </Row>
              </div>

              {/* Profil & smak */}
              {u.hasProfile && (
                <>
                  <h3 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Profil & smak</h3>
                  <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                    <Row label="Ålder">{u.age ?? "—"}</Row>
                    <Row label="Språk / region">
                      {(u.uiLanguage ?? "—").toUpperCase()} · {u.region ?? "—"}
                    </Row>
                    <Row label="Tjänster">
                      <Tags items={u.providers} />
                    </Row>
                    <Row label="Gillar genrer">
                      <Tags items={u.favoriteGenres} tone="good" />
                    </Row>
                    <Row label="Ogillar">
                      <Tags items={u.dislikedGenres} tone="bad" />
                    </Row>
                    <Row label="Favoritfilm">{u.favoriteMovie ?? "—"}</Row>
                    <Row label="Favoritserie">{u.favoriteShow ?? "—"}</Row>
                    <Row label="Swipar">
                      {u.swipeMediaFilter === "movie" ? "Film" : u.swipeMediaFilter === "tv" ? "Serier" : "Båda"}
                      {u.showKidsContent ? " · barninnehåll på" : ""}
                    </Row>
                    <Row label="Dagliga tips">{u.notifyDailyRecs ? "På" : "Av"}</Row>
                  </div>
                </>
              )}

              {/* Senaste swipes */}
              {data.recent.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">
                    Senaste swipes
                  </h3>
                  <div className="grid gap-1.5">
                    {data.recent.map((r) => {
                      const d = DECISION_LABEL[r.decision] ?? { label: r.decision, cls: "bg-white/10 text-white/60" };
                      return (
                        <div
                          key={`${r.mediaType}_${r.tmdbId}`}
                          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2"
                        >
                          {r.poster ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.poster} alt="" className="h-12 w-8 shrink-0 rounded object-cover" loading="lazy" />
                          ) : (
                            <div className="h-12 w-8 shrink-0 rounded bg-white/10" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-white/85">
                              {r.title}
                              {r.year && <span className="text-white/40"> ({r.year})</span>}
                            </div>
                            <div className="text-[11px] text-white/40">
                              {r.mediaType === "tv" ? "Serie" : "Film"} · {ago(r.decidedAt)}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${d.cls}`}>
                            {d.label}
                            {r.rating != null && ` ${r.rating}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {data.groups.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Grupper</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.groups.map((g) => (
                      <span key={g.code} className="rounded-lg bg-white/[0.06] px-2 py-1 text-xs text-white/70">
                        {g.code} · {g.members} pers
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* Adminåtgärder */}
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Åtgärder</h3>
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-white/60">Plan</span>
                  <select
                    value={u.plan}
                    disabled={busy}
                    onChange={(e) => void adminAction({ action: "setPlan", plan: e.target.value })}
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white/85"
                  >
                    <option value="free">free</option>
                    <option value="premium">premium</option>
                    <option value="lifetime">lifetime</option>
                  </select>
                </label>
                {!u.verified && u.email && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void adminAction({ action: "resendVerify" })}
                    className="w-full rounded-lg border border-white/15 px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
                  >
                    Skicka verifieringsmail igen
                  </button>
                )}
                {data.relation !== "self" &&
                  (confirmDelete ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void adminAction({ action: "delete" })}
                        className="flex-1 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
                      >
                        Ja, radera allt
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-lg border border-white/15 px-3 py-2.5 text-sm text-white/70"
                      >
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      className="w-full rounded-lg border border-rose-500/40 px-3 py-2.5 text-sm text-rose-300 hover:bg-rose-500/10"
                    >
                      Radera konto
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
