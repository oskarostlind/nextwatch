// app/group/swipe/page.tsx
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../../../lib/prisma";
import Client from "./Client";

export const dynamic = "force-dynamic";

export default async function GroupSwipePageWrapper() {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) {
    redirect("/onboarding?next=/group/swipe");
  }
  const profile = await prisma.profile.findUnique({ where: { userId: uid }, select: { userId: true } });
  if (!profile) {
    redirect("/onboarding?next=/group/swipe");
  }

  return (
    <main className="mx-auto w-full max-w-3xl pb-16">
      <Suspense fallback={<div className="p-6 text-neutral-400">Laddar…</div>}>
        <Client />
      </Suspense>
    </main>
  );
}
