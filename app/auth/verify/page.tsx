// app/auth/verify/page.tsx
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Client from "./client";

// Gör sidan dynamisk så den inte försöker statiskt för-renderas.
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const t = await getTranslations("auth");
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg">
        <h1 className="mb-3 text-2xl font-semibold">{t("verifyingEmail")}</h1>
        <Suspense
          fallback={<p className="text-white/70">{t("pleaseWait")}</p>}
        >
          <Client />
        </Suspense>
      </div>
    </div>
  );
}
