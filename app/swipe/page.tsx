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
  const profile = await prisma.profile.findUnique({ where: { userId: uid }, select: { userId: true } });
  if (!profile) {
    redirect("/onboarding?next=/swipe");
  }

  const groupCode = c.get("nw_group")?.value?.trim() ?? null;

  if (groupCode) {
    return <GroupSwipeClient initialCode={groupCode} />;
  }

  return (
    <>
      <Client />
      <SwipeGestureTour />
    </>
  );
}
