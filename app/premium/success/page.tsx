import { useTranslations } from "next-intl";
export const dynamic = "force-dynamic";

export default function PremiumSuccess() {
  const t = useTranslations("premiumSuccess");
  return (
    <div className="max-w-lg mx-auto p-6 space-y-3">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p>{t("body")}</p>
      <a className="underline" href="/group">Till grupper</a>
    </div>
  );
}
