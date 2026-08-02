"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import MatchesTab, { type GroupMatchItem } from "./components/MatchesTab";
import IncomingInvites from "./components/IncomingInvites";
import { PageHeader, SegmentedTabs } from "@/app/components/ui/kit";
import GuideOverlay from "@/app/components/client/GuideOverlay";
import { GROUP_GUIDE_STEPS } from "@/lib/guideSteps";
import { hasSeenGuide, releaseGuide, tryAcquireGuide } from "@/lib/userGuide";
import { useSocial } from "@/app/components/client/SocialProvider";
import type { GroupInitial } from "./page";

export type { PublicMember, GroupInitial } from "./page";

type Tab = "group" | "matches" | "friends";

/** Namnrymd för "senast sedd match"-tidsstämpeln som styr Matchningar-badgen. */
const MATCHES_SEEN_PREFIX = "nw_matches_seen:";

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<Tab>("group");
  const [groupGuideOpen, setGroupGuideOpen] = useState(false);

  // Samma live-gruppkod som GroupTab/FriendsTab redan synkar mot via
  // social-store:n — annars ligger badgen och matchlistan kvar på den gamla
  // gruppen tills nästa fulla server-refresh.
  const social = useSocial();
  const groupCode = social.groupCode ?? initial.code;

  const [matches, setMatches] = useState<GroupMatchItem[] | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);

  const refetchMatches = useCallback(() => {
    if (!groupCode) {
      setMatches([]);
      return;
    }
    void fetch(`/api/group/matches?code=${encodeURIComponent(groupCode)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; items?: GroupMatchItem[] } | null) => {
        setMatches(j?.ok ? j.items ?? [] : []);
      })
      .catch(() => setMatches((prev) => prev ?? []));
  }, [groupCode]);

  useEffect(() => {
    setMatches(null);
    refetchMatches();
  }, [refetchMatches]);

  useEffect(() => {
    if (!groupCode) {
      setSeenAt(null);
      return;
    }
    try {
      setSeenAt(window.localStorage.getItem(MATCHES_SEEN_PREFIX + groupCode));
    } catch {
      setSeenAt(null);
    }
  }, [groupCode]);

  const hasUnseenMatch = useMemo(() => {
    const latest = matches?.[0]?.matchedAt;
    return Boolean(latest) && latest !== seenAt;
  }, [matches, seenAt]);

  const openTab = useCallback(
    (next: Tab) => {
      setTab(next);
      if (next === "matches" && groupCode && matches?.[0]) {
        try {
          window.localStorage.setItem(MATCHES_SEEN_PREFIX + groupCode, matches[0].matchedAt);
        } catch {
          /* no-op */
        }
        setSeenAt(matches[0].matchedAt);
      }
    },
    [groupCode, matches]
  );

  const tabs = useMemo(
    () => [
      { id: "group" as const, label: "Grupp" },
      { id: "matches" as const, label: hasUnseenMatch ? "Matchningar •" : "Matchningar" },
      { id: "friends" as const, label: "Vänner" },
    ],
    [hasUnseenMatch]
  );

  // "Visa igen"-knappen för vän-genomgången (Profil → Inställningar) länkar
  // hit med ?tour=friends-tour — den ligger på fliken Vänner, så växla dit
  // efter mount (inte i useState-initieraren: window finns inte server-side,
  // och det skulle ge en hydration-mismatch mot SSR-markeringen).
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("tour") === "friends-tour") {
        setTab("friends");
      }
    } catch {
      /* no-op */
    }
  }, []);

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
        <SegmentedTabs tabs={tabs} value={tab} onChange={openTab} layoutId="group-tabs" />
      </div>

      {tab === "group" ? (
        <GroupTab
          initialCode={initial.code}
          initialRegion={initial.region}
          initialMembers={initial.members}
          initialMeUserId={initial.meUserId}
        />
      ) : tab === "matches" ? (
        <MatchesTab code={groupCode} items={matches} />
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
