// app/group/swipe/Client.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import GroupBar from "./GroupBar";
import { useSocial } from "@/app/components/client/SocialProvider";

const LegacyGroupSwipe = dynamic(() => import("./_legacy"), { ssr: false });

type Props = { initialCode?: string | null };

export default function Client({ initialCode = null }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const codeFromUrl = (sp.get("code") || "").toUpperCase();
  const fromInitial = initialCode?.trim()?.toUpperCase() ?? "";
  const code = fromInitial || codeFromUrl;

  // socialStore pollar /api/group/members i bakgrunden. Om vi kom hit via vår
  // egen aktiva grupp-cookie (fromInitial) men servern rapporterar att vi
  // inte längre är medlem — lämnade själva, eller blev utsparkade i en annan
  // flik/enhet — hoppa tillbaka till solo-swipe direkt i stället för att sitta
  // fast i gruppläget tills sidan laddas om manuellt. Rör inte deep-link-flödet
  // (?code= utan egen cookie) — det är en separat funktion.
  const social = useSocial();
  useEffect(() => {
    if (!fromInitial) return;
    if (!social.membersReady) return;
    if (social.groupCode === fromInitial) return;
    router.replace("/swipe");
  }, [fromInitial, social.membersReady, social.groupCode, router]);

  return (
    <>
      <GroupBar code={code} />
      <LegacyGroupSwipe code={code} />
    </>
  );
}
