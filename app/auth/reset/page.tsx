// app/auth/reset/page.tsx
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Client from "./client";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/60 p-6 shadow-xl backdrop-blur">
        <Suspense fallback={<p className="text-neutral-400">{t("loading")}</p>}>
          <Client />
        </Suspense>
      </div>
    </div>
  );
}
