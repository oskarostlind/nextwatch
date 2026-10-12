import { getTranslations } from "next-intl/server";
import VerifySentClient from "./client";

export const dynamic = "force-dynamic";

// Efter e-postregistrering. Fram till 2026-10-12 var det här en
// återvändsgränd: bara "Öppna Gmail" (iOS-användare har oftast Apple Mail) och
// en "Skicka igen"-länk som bara laddade om sidan — ingen väg tillbaka till
// swipen. Nu kan man swipa vidare direkt; kontot blir verifierat när länken
// klickas, oavsett var man är i appen.
export default async function VerifySentPage() {
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="mb-2 text-2xl font-semibold">{t("checkEmail")}</h1>
        <VerifySentClient />
      </div>
    </main>
  );
}
