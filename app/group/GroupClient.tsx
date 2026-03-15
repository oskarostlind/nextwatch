"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import IncomingInvites from "./components/IncomingInvites";

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

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<"group" | "friends">("group");

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <IncomingInvites />
      {/* --- Animated Tabs (Tinder Style) --- */}
      <div className="flex w-fit items-center gap-1 rounded-full bg-white/5 p-1 shadow-inner">
        {(["group", "friends"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative px-6 py-2 text-sm font-semibold capitalize transition-colors"
          >
            {tab === t && (
              <motion.div
                layoutId="group-tabs"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            )}
            <span className={`relative z-10 ${tab === t ? "text-black" : "text-white/60 hover:text-white"}`}>
              {t}
            </span>
          </button>
        ))}
      </div>

      {/* --- Tab Content --- */}
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