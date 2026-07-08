"use client";

import { useEffect, useState } from "react";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import IncomingInvites from "./components/IncomingInvites";
import { PageHeader, SegmentedTabs } from "@/app/components/ui/kit";
import GuideOverlay from "@/app/components/client/GuideOverlay";
import { GROUP_GUIDE_STEPS } from "@/lib/guideSteps";
import { hasSeenGuide } from "@/lib/userGuide";
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
    const t = window.setTimeout(() => setGroupGuideOpen(true), 500);
    return () => window.clearTimeout(t);
  }, []);

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
        onClose={() => setGroupGuideOpen(false)}
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
