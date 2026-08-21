"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GroupTab from "./components/GroupTab";
import FriendsTab from "./components/FriendsTab";
import MatchesTab, { type GroupMatchItem } from "./components/MatchesTab";
import IncomingInvites from "./components/IncomingInvites";
import { PageHeader, SegmentedTabs } from "@/app/components/ui/kit";
import { useSocial } from "@/app/components/client/SocialProvider";
import type { GroupInitial } from "./page";
import { useTranslations } from "next-intl";

export type { PublicMember, GroupInitial } from "./page";

type Tab = "group" | "matches" | "friends";

/** Namnrymd för "senast sedd match"-tidsstämpeln som styr Matchningar-badgen. */
const MATCHES_SEEN_PREFIX = "nw_matches_seen:";

export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const t = useTranslations("group");
  const [tab, setTab] = useState<Tab>("group");

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
      { id: "group" as const, label: t("tabGroup") },
      { id: "matches" as const, label: hasUnseenMatch ? t("tabMatchesUnseen") : t("tabMatches") },
      { id: "friends" as const, label: t("tabFriends") },
    ],
    [hasUnseenMatch, t]
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

  // Ingen sid-bred genomgång här längre: grupp- och vänhintarna bor i
  // GroupTab/FriendsTab och tänds först när ytan de beskriver finns på
  // skärmen (lib/tours/coachSteps.ts).

  return (
    <div className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pb-8 pt-4">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

      <IncomingInvites />

      <div className="mb-5 mt-1">
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

    </div>
  );
}
