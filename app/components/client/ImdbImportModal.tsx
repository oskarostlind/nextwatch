"use client";

import { useRef, useState } from "react";
import { SegmentedTabs, Button, Note } from "@/app/components/ui/kit";
import { useTranslations } from "next-intl";

type ImportMode = "ratings" | "watchlist";

type ImportResult = {
  ok: boolean;
  imported?: number;
  skipped?: number;
  failed?: number;
  sampleErrors?: string[];
  message?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
};

export default function ImdbImportModal({ open, onClose, onDone }: Props) {
  const t = useTranslations("imdb");
  const [mode, setMode] = useState<ImportMode>("ratings");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function runImport(file: File) {
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    try {
      const res = await fetch("/api/ratings/import", { method: "POST", body: fd });
      const data = (await res.json()) as ImportResult;
      setResult(data);
      if (data.ok && (data.imported ?? 0) > 0) onDone();
    } catch {
      setResult({ ok: false, message: t("networkError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto space-y-4 rounded-2xl border border-white/15 bg-neutral-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">{t("heading")}</h2>

        <SegmentedTabs
          layoutId="imdb-import-mode"
          tabs={[
            { id: "ratings" as ImportMode, label: "Betyg" },
            { id: "watchlist" as ImportMode, label: "Watchlist" },
          ]}
          value={mode}
          onChange={setMode}
        />

        <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-300">
          <li>{t("step1")}</li>
          <li>
            {t.rich("step2", {
              target: () => (
                <strong className="text-white">
                  {mode === "ratings" ? "Your Ratings" : "Your Watchlist"}
                </strong>
              ),
            })}
          </li>
          <li>
            {t.rich("step3", {
              export: (chunks) => <strong className="text-white">{chunks}</strong>,
            })}
          </li>
          <li>{t("step4")}</li>
        </ol>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runImport(f);
            e.target.value = "";
          }}
        />

        <Button
          variant="primary"
          disabled={busy}
          className="w-full"
          onClick={() => fileRef.current?.click()}
        >
          {busy ? t("importing") : t("pickFile")}
        </Button>

        {result ? (
          result.ok ? (
            <Note tone="success">
              {t("resultImported", { count: result.imported ?? 0 })}
              {(result.skipped ?? 0) > 0 ? t("resultSkipped", { count: result.skipped ?? 0 }) : ""}
              {(result.failed ?? 0) > 0 ? t("resultFailed", { count: result.failed ?? 0 }) : ""}.
              {result.sampleErrors?.length ? (
                <ul className="mt-2 list-disc pl-4 text-xs opacity-90">
                  {result.sampleErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </Note>
          ) : (
            <Note tone="error">{result.message ?? "Import misslyckades."}</Note>
          )
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="w-full text-center text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}
