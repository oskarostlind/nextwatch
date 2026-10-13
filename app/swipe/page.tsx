import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../../lib/prisma";
import Client from "./page_client";
import GroupSwipeClient from "../group/swipe/Client";
import SwipeGestureTour from "../components/client/tours/SwipeGestureTour";

export default async function Page() {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) {
    redirect("/onboarding?next=/swipe");
  }
  const profile = await prisma.profile.findUnique({
    where: { userId: uid },
    // avatarId/updatedAt: avataren uppe till höger (ProfileAvatarButton) — tas
    // i samma fråga i stället för en extra /api/profile-hämtning på klienten.
    select: { userId: true, providers: true, avatarId: true, updatedAt: true },
  });
  if (!profile) {
    redirect("/onboarding?next=/swipe");
  }

  const groupCode = c.get("nw_group")?.value?.trim() ?? null;

  if (groupCode) {
    return <GroupSwipeClient initialCode={groupCode} />;
  }

  return (
    <>
      {/* Profil utan tjänster (typiskt gäst som hoppade över onboardingen) →
          ProviderPromptSheet frågar efter några swipes. */}
      <Client
        needsProviders={!Array.isArray(profile.providers) || profile.providers.length === 0}
        me={{
          userId: profile.userId,
          avatarId: profile.avatarId ?? null,
          updatedAt: profile.updatedAt ? profile.updatedAt.toISOString() : null,
        }}
      />
      <SwipeGestureTour />
    </>
  );
}
