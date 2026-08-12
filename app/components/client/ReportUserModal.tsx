"use client";

// Anmälan av en användare — App Store Guideline 1.2 kräver att appar med
// användargenererat innehåll (visningsnamn, användarnamn, delade filmtips) har
// både rapport OCH blockering, nåbart där innehållet visas. Blockeringen sker
// via samma anrop, så den som anmäler slipper fortsatt kontakt direkt.

import { useEffect, useState } from "react";
import Modal from "@/app/components/ui/Modal";

const REASONS = [
  { id: "olämpligt-namn", label: "Olämpligt namn eller användarnamn" },
  { id: "trakasserier", label: "Trakasserier eller hot" },
  { id: "spam", label: "Spam" },
  { id: "olämpligt-innehåll", label: "Olämpligt innehåll" },
  { id: "annat", label: "Annat" },
] as const;

export default function ReportUserModal({
  userId,
  userLabel,
  onClose,
  onReported,
}: {
  /** null = stängd */
  userId: string | null;
  /** Namnet som visas i rubriken. */
  userLabel?: string;
  onClose: () => void;
  /** Anropas efter lyckad anmälan (t.ex. för att uppdatera vänlistan). */
  onReported?: (opts: { blocked: boolean }) => void;
}) {
  const [reason, setReason] = useState<string>(REASONS[0].id);
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      setReason(REASONS[0].id);
      setDetails("");
      setBlock(true);
      setDone(false);
      setErr(null);
    }
  }, [userId]);

  async function submit() {
    if (!userId) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reason, details, block }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; blocked?: boolean };
      if (!res.ok || !data.ok) {
        setErr(data.message ?? "Kunde inte skicka anmälan.");
        return;
      }
      setDone(true);
      onReported?.({ blocked: Boolean(data.blocked) });
    } catch {
      setErr("Nätverksfel. Försök igen.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={!!userId} onClose={onClose}>
      <div className="space-y-4 p-2">
        <div>
          <h3 className="text-lg font-bold text-white">
            Anmäl {userLabel ? userLabel : "användare"}
          </h3>
          <p className="mt-1 text-xs text-white/50">
            Vi granskar alla anmälningar inom 24 timmar och tar bort innehåll eller stänger av
            konton som bryter mot villkoren.
          </p>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Tack! Anmälan är mottagen{block ? " och användaren är blockerad" : ""}.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Stäng
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/80 transition hover:bg-white/[0.07]"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.id}
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                    className="accent-cyan-400"
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/50">Beskriv gärna (valfritt)</label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/40"
                placeholder="Vad hände?"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-white/80">
              <input
                type="checkbox"
                checked={block}
                onChange={(e) => setBlock(e.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
              Blockera användaren också
            </label>

            {err && (
              <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {err}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending}
                className="flex-1 rounded-xl bg-rose-500/90 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {sending ? "Skickar…" : "Skicka anmälan"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
