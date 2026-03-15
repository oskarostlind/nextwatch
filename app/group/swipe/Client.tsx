// app/group/swipe/Client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import GroupBar from "./GroupBar";
import OverlayMount from "../../components/client/OverlayMount";

const LegacyGroupSwipe = dynamic(() => import("./_legacy"), { ssr: false });

type Props = { initialCode?: string | null };

export default function Client({ initialCode = null }: Props) {
  const sp = useSearchParams();
  const codeFromUrl = (sp.get("code") || "").toUpperCase();
  const fromInitial = initialCode?.trim()?.toUpperCase() ?? "";
  const code = fromInitial || codeFromUrl;

  return (
    <>
      <GroupBar code={code} />
      <LegacyGroupSwipe code={code} />
      <OverlayMount />
    </>
  );
}
