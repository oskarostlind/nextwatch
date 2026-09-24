import { getTranslations } from "next-intl/server";
import RegisterClient from "./page_client";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-6 backdrop-blur">
        <h1 className="mb-1 text-2xl font-semibold">{t("registerTitle")}</h1>
        <p className="mb-6 text-sm text-neutral-400">{t("registerOptional")}</p>
        <RegisterClient />
      </div>
    </main>
  );
}
