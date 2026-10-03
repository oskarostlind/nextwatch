// lib/acquisitionServer.ts — serversidan av källspårningen (se lib/acquisition.ts).
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACQ_COOKIE, decodeAcquisition, type Acquisition } from "@/lib/acquisition";

/**
 * Konton skapade före källspårningen fick ingen källa. Utan den här gränsen
 * hade en gammal användare som loggar in via en annons i dag stämplats som
 * "meta" — men annonsen värvade dem inte. De förblir "Okänd".
 */
const TRACKING_START = new Date("2026-10-03T18:00:00Z");

export async function readAcquisitionCookie(): Promise<Acquisition | null> {
  try {
    return decodeAcquisition((await cookies()).get(ACQ_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * Stämplar källan på användaren om den saknas (första beröring vinner).
 * Anropas där konton skapas eller identifieras: session/init, gäst,
 * onboarding, registrering och Sign in with Apple. Best effort — ett fel här
 * får aldrig fälla inloggningen.
 */
export async function stampAcquisition(userId: string | null | undefined, acq?: Acquisition | null): Promise<void> {
  if (!userId) return;
  try {
    const a = acq ?? (await readAcquisitionCookie());
    if (!a) return;
    const at = new Date(a.at);
    await prisma.user.updateMany({
      where: { id: userId, acqSource: null, createdAt: { gte: TRACKING_START } },
      data: {
        acqSource: a.source,
        acqMedium: a.medium,
        acqCampaign: a.campaign,
        acqContent: a.content,
        acqReferrer: a.referrer,
        acqLanding: a.landing,
        acqAt: Number.isNaN(at.getTime()) ? new Date() : at,
      },
    });
  } catch (e) {
    console.warn("[acquisition] stamp failed", e instanceof Error ? e.message : e);
  }
}
