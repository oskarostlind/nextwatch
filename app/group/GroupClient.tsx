"use client";

import { useState } from "react";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import IncomingInvites from "./components/IncomingInvites";
import { PageHeader, SegmentedTabs } from "@/app/components/ui/kit";

export type PublicMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  providers?: string[];
};

export type GroupInitial = {
  code: string | null;
  region?: string;
  members: PublicMember[];
  meUserId?: string | null;
};

const TABS = [
  { id: "group" as const, label: "Grupp" },
  { id: "friends" as const, label: "Vänner" },
];

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<"group" | "friends">("group");

  return (
    <div className="mx-auto max-w-lg px-4 pb-8 pt-4">
      <PageHeader title="Tillsammans" subtitle="Swipa i grupp eller lägg till vänner." />

      <IncomingInvites />

      <div className="mb-5 mt-1">
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
        <FriendsTab />
      )}
    </div>
  );
}
