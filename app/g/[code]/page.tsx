// app/g/[code]/page.tsx — inbjudningslänken https://www.nextwatch.se/g/<KOD>
// (nya flödet del 6). Öppnar gruppleken direkt: ingen app, inget konto, ingen
// kod att skriva in. Servern avgör bara det som går att avgöra utan att
// skriva något — finns gruppen, och får besökaren plats? Själva anslutningen
// (gästprofil, medlemskap, nw_group-cookie) gör LinkClient via
// /api/group/link-join, eftersom en serverkomponent inte kan sätta cookies.
//
// Universal links: public/.well-known/apple-app-site-association finns inte
// och iOS-appen saknar associated-domains-entitlement, så /g/* öppnas alltid
// på webben på iOS (fungerar fullt ut). Läggs universal links till senare
// måste appen ladda länkens sökväg vid appUrlOpen (https) — Capacitor gör inte
// det själv, den öppnar server.url. Samma gäller Android-appens App Links
// (hela domänen, AndroidManifest) — TODO(nya-flodet): AppDeepLinkHandler
// navigerar i dag bara nextwatch://-länkar.

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { getGroupCapacity } from "@/lib/groupLimits";
import { inviterSummary, normalizeGroupCode } from "@/lib/referral";
import { appStoreUrl } from "@/lib/seo";
import LinkClient from "./LinkClient";
import AppStoreLink from "./AppStoreLink";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code: raw } = await params;
  const code = normalizeGroupCode(raw);
  const t = await getTranslations("invite");
  const host = code ? await inviterSummary(code) : { name: null, likes: 0 };
  const title = host.name ? t("meta.titleNamed", { name: host.name }) : t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    // Privat grupplänk — ska aldrig indexeras (lib/seo PRIVATE_PATHS gäller /group, inte /g).
    robots: { index: false, follow: false },
    openGraph: { title, description, url: code ? `/g/${code}` : undefined, type: "website" },
  };
}

async function Notice({ kind, max }: { kind: "invalid" | "full"; max?: number }) {
  const t = await getTranslations("invite");
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="text-4xl" aria-hidden="true">
        {kind === "full" ? "🍿" : "🎬"}
      </span>
      <h1 className="text-2xl font-extrabold tracking-tight">{t(kind === "full" ? "full.title" : "invalid.title")}</h1>
      <p className="max-w-sm text-[15px] leading-relaxed text-neutral-300">
        {kind === "full" ? t("full.body", { max: max ?? 3 }) : t("invalid.body")}
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-12 items-center justify-center rounded-[14px] bg-cyan-400 px-6 text-base font-extrabold text-neutral-950"
      >
        {t("invalid.cta")}
      </Link>
      <AppStoreLink href={appStoreUrl("invite-link-notice")} label={t("invalid.app")} />
    </main>
  );
}

export default async function InviteLinkPage({ params }: Params) {
  const { code: raw } = await params;
  const code = normalizeGroupCode(raw);
  if (!code) return <Notice kind="invalid" />;

  const group = await prisma.group.findUnique({ where: { code }, select: { code: true } });
  if (!group) return <Notice kind="invalid" />;

  // Redan medlem (t.ex. värden själv, eller vännen som öppnar länken igen)
  // släpps alltid in. Annars: respektera taket enligt skaparens plan.
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  const member = uid
    ? await prisma.groupMember.findUnique({
        where: { groupCode_userId: { groupCode: code, userId: uid } },
        select: { userId: true },
      })
    : null;
  if (!member) {
    const cap = await getGroupCapacity(code);
    if (cap.isFull) return <Notice kind="full" max={cap.max} />;
  }

  const host = await inviterSummary(code);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
      <LinkClient code={code} hostName={host.name} hostLikes={host.likes} appStoreHref={appStoreUrl("invite-link")} />
    </main>
  );
}
