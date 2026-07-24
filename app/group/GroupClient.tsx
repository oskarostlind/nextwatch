"use client";

import { useEffect, useState } from "react";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import IncomingInvites from "./components/IncomingInvites";
import { PageHeader, SegmentedTabs } from "@/app/components/ui/kit";
import GuideOverlay from "@/app/components/client/GuideOverlay";
import { GROUP_GUIDE_STEPS } from "@/lib/guideSteps";
import { hasSeenGuide, releaseGuide, tryAcquireGuide } from "@/lib/userGuide";
import type { GroupInitial } from "./page";

export type { PublicMember, GroupInitial } from "./page";

const TABS = [
  { id: "group" as const, label: "Grupp" },
  { id: "friends" as const, label: "Vänner" },
];

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<"group" | "friends">("group");
  const [groupGuideOpen, setGroupGuideOpen] = useState(false);

  useEffect(() => {
    if (hasSeenGuide("group")) return;
    // Öppna bara om ingen annan guide är aktiv (t.ex. nav-guiden mitt i sitt flöde).
    const t = window.setTimeout(() => {
      if (tryAcquireGuide("group")) setGroupGuideOpen(true);
    }, 500);
    return () => window.clearTimeout(t);
  }, []);

  // Släpp låset om sidan lämnas medan guiden är öppen — annars blockeras andra
  // guider resten av sessionen. (Egen unmount-effekt, inte kopplad till öppna-
  // villkoret ovan.)
  useEffect(() => () => releaseGuide("group"), []);

  return (
    <div className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pb-8 pt-4">
      <PageHeader eyebrow="Socialt" title="Tillsammans" subtitle="Swipa i grupp eller lägg till vänner." />

      <IncomingInvites />

      <div className="mb-5 mt-1" data-guide="group-tabs">
        <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} layoutId="group-tabs" />
      </div>

      {tab === "group" ? (
        <GroupTab
          initialCode={initial.code}
          initialRegion={initial.region}
          initialMembers={initial.members}
          initialMeUserId={initial.meUserId}
        />
      ) : (
        <FriendsTab initial={initial.friends} />
      )}

      <GuideOverlay
        guideId="group"
        steps={GROUP_GUIDE_STEPS}
        open={groupGuideOpen}
        onClose={() => {
          setGroupGuideOpen(false);
          releaseGuide("group");
        }}
        onStepChange={(_, step) => {
          if (step.target === "friends-search") setTab("friends");
          if (step.target === "group-create-join" || step.target === "group-start-swipe") {
            setTab("group");
          }
        }}
      />
    </div>
  );
}
