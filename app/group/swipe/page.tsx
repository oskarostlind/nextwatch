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
    // Flex-kolumn hela vägen ner så kortleken (flex-1) får riktig höjd, som på /swipe.
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
      <Suspense fallback={<div className="p-6 text-neutral-400">Laddar…</div>}>
        <Client />
      </Suspense>
    </main>
  );
}
