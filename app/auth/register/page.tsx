import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import RegisterClient from "./page_client";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const t = await getTranslations("auth");
  // Godkände villkoren redan i onboardingen (User.termsAcceptedAt)? Då frågar
  // vi inte en gång till — det var två identiska kryssrutor på två skärmar i rad.
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  const user = uid
    ? await prisma.user.findUnique({ where: { id: uid }, select: { termsAcceptedAt: true } }).catch(() => null)
    : null;
  const termsAlreadyAccepted = Boolean(user?.termsAcceptedAt);
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-6 backdrop-blur">
        <h1 className="mb-1 text-2xl font-semibold">{t("registerTitle")}</h1>
        <p className="mb-6 text-sm text-neutral-400">{t("registerOptional")}</p>
        <RegisterClient termsAlreadyAccepted={termsAlreadyAccepted} />
      </div>
    </main>
  );
}
