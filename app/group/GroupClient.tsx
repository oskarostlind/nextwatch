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

const TABS = [
  { id: "group" as const, label: "Grupp" },
  { id: "friends" as const, label: "Vänner" },
];

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<"group" | "friends">("group");

  return (
    <div className="mx-auto max-w-lg px-4 pb-8 pt-4">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Tillsammans</h1>
        <p className="mt-1 text-sm text-white/50">Swipa i grupp eller lägg till vänner.</p>
      </header>

      <IncomingInvites />

      <div className="mb-5 flex w-full items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="relative flex-1 px-4 py-2 text-sm font-semibold transition-colors"
          >
            {tab === t.id && (
              <motion.div
                layoutId="group-tabs"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            )}
            <span className={`relative z-10 ${tab === t.id ? "text-black" : "text-white/60 hover:text-white"}`}>
              {t.label}
            </span>
          </button>
        ))}
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
