"use client";

// Avataren uppe till höger på swipe-skärmen. Sedan 2026-10-13 är Profil inte
// längre en flik i BottomTabs ("två lager, inte tre") — det här är vägen dit
// på mobilen, och den ersätter kugghjulet som låg på samma plats.

import Link from "next/link";
import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";
import { avatarUrl } from "@/lib/avatars";
import { getCached } from "@/lib/clientCache";

// Samma nyckel som app/profile/ProfileClient.tsx läser/skriver.
const PROFILE_CACHE_KEY = "profile_v1";

/** Det servern vet om inloggad användare när sidan renderades. */
export type AvatarButtonUser = {
  userId: string;
  avatarId: string | null;
  /** Profile.updatedAt (ISO) — avgör om klientcachen är nyare än serverns svar. */
  updatedAt: string | null;
};

export default function ProfileAvatarButton({ me }: { me?: AvatarButtonUser | null }) {
  const t = useTranslations("nav");
  const [avatarId, setAvatarId] = useState<string | null>(me?.avatarId ?? null);

  const userId = me?.userId ?? null;
  const serverAvatarId = me?.avatarId ?? null;
  const serverUpdatedAt = me?.updatedAt ?? null;

  useEffect(() => {
    setAvatarId(serverAvatarId);
    // Serverns värde kan vara inaktuellt: router-cachen (staleTimes) serverar
    // /swipe:s gamla RSC-svar när man går tillbaka från profilen, så en nyss
    // vald avatar syns inte förrän cachen löpt ut. ProfileClient skriver sitt
    // sparsvar till klientcachen — använd det om det gäller SAMMA konto (delad
    // enhet) och är nyare än det servern renderade.
    if (!userId) return;
    const cached = getCached<Record<string, unknown>>(PROFILE_CACHE_KEY);
    if (!cached || cached.userId !== userId) return;
    const cachedAt = typeof cached.updatedAt === "string" ? Date.parse(cached.updatedAt) : NaN;
    const serverAt = serverUpdatedAt ? Date.parse(serverUpdatedAt) : 0;
    if (!(cachedAt > serverAt)) return;
    if (typeof cached.avatarId === "string" || cached.avatarId === null) {
      setAvatarId(cached.avatarId);
    }
  }, [userId, serverAvatarId, serverUpdatedAt]);

  const url = avatarUrl(avatarId);

  return (
    <Link
      href="/profile"
      prefetch
      aria-label={t("profileAndSettings")}
      title={t("profileAndSettings")}
      // 44 px tryckyta runt en 36 px rund avatar — syns liten, träffas lätt.
      className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
    >
      <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/15 transition duration-100 group-hover:ring-white/30 group-active:scale-90">
        {url ? (
          // Vanlig <img> med flit (som Avatar.tsx): next/image vägrar SVG.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" width={36} height={36} className="h-full w-full" draggable={false} />
        ) : (
          <User aria-hidden className="h-[18px] w-[18px] text-white/60" />
        )}
      </span>
    </Link>
  );
}
