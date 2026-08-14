"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, Card, Note } from "../../components/ui/kit";
import { useTranslations } from "next-intl";

export default function GroupMatchPage() {
  const t = useTranslations("groupMatchPage");
  return (
    <Suspense fallback={<div className="p-6">{t("loading")}</div>}>
      <GroupMatchInner />
    </Suspense>
  );
}

type MatchItem = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  title: string;
  year?: number;
  rating?: number;
};

type MatchResponse = {
  ok: boolean;
  need: number;
  size: number;
  count: number;
  match: MatchItem | null;
  message?: string;
};

function GroupMatchInner() {
  const t = useTranslations("groupMatchPage");
  const sp = useSearchParams();
  const code = sp?.get("code") || "";
  const [data, setData] = useState<MatchResponse | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!code) return;
    fetch(`/api/group/match?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((js: MatchResponse) => (js.ok ? setData(js) : setErr(js.message || "Fel")))
      .catch((e) => setErr(String(e)));
  }, [code]);

  if (!code) {
    return (
      <div className="p-6 text-sm text-neutral-400">
        {t.rich("noCode", {
          link: (chunks: React.ReactNode) => (
            <a className="text-cyan-400 underline underline-offset-2" href="/group">
              {chunks}
            </a>
          ),
        })}
      </div>
    );
  }
  if (err) return <div className="p-6"><Note tone="error">{err}</Note></div>;
  if (!data) return <div className="p-6 text-neutral-400">{t("loading")}</div>;
  if (!data.match) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <PageHeader eyebrow={t("eyebrow")} title={t("noMatchTitle")} subtitle={t("noMatchSubtitle")} />
        <Card>
          <p className="text-sm text-neutral-400">
            {t("sizeNeed", { size: data.size, need: data.need })}
          </p>
        </Card>
      </div>
    );
  }

  const m = data.match;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("matchTitle")}
        subtitle={t("matchSubtitle", { size: data.size, need: data.need, count: data.count })}
      />
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-white">
            {m.title || `TMDb #${m.tmdbId}`}{" "}
            <span className="text-xs text-neutral-500">({m.tmdbType === "movie" ? t("typeMovie") : t("typeTv")})</span>
          </div>
          {typeof m.rating === "number" && (
            <div className="text-sm text-neutral-400">★ {m.rating.toFixed(1)}</div>
          )}
        </div>
        <a
          className="shrink-0 text-sm text-cyan-400 underline underline-offset-2"
          href={`https://www.themoviedb.org/${m.tmdbType}/${m.tmdbId}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("openOnTmdb")}
        </a>
      </Card>
    </div>
  );
}
