// app/api/user/delete/route.ts
//
// Radering av eget konto inifrån appen. Apple Guideline 5.1.1(v) kräver detta
// när appen kan skapa konton (e-post/lösenord samt Sign in with Apple).
//
// Allt användardata försvinner via cascade: schema.prisma har onDelete:Cascade
// på samtliga relationer till User (profil, ratings, watchlist, köp, push-tokens,
// grupper man skapat, röster, vänner, inbjudningar m.m.), så en enda
// prisma.user.delete räcker.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bästa försök att säga upp en aktiv Stripe-prenumeration så att kunden inte
 *  fortsätter debiteras efter att kontot raderats. Fel får aldrig blockera
 *  själva raderingen. Apple-IAP-prenumerationer kan inte sägas upp server-side
 *  (hanteras av användaren i App Store) och lämnas därför orörda. */
async function cancelStripeIfAny(stripeCustomerId: string | null): Promise<void> {
  if (!stripeCustomerId) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;
  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "active",
      limit: 100,
    });
    await Promise.all(subs.data.map((s) => stripe.subscriptions.cancel(s.id)));
  } catch (e) {
    console.warn("[user/delete] Stripe-uppsägning misslyckades (best-effort):", e instanceof Error ? e.message : e);
  }
}

export async function POST() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, stripeCustomerId: true },
    });
    if (!user) {
      // Kontot finns inte (redan raderat eller enbart anonym cookie). Städa
      // ändå cookies så klienten hamnar i utloggat läge.
      const res = NextResponse.json({ ok: true, alreadyGone: true });
      clearSession(res);
      return res;
    }

    await cancelStripeIfAny(user.stripeCustomerId);

    await prisma.user.delete({ where: { id: uid } });

    const res = NextResponse.json({ ok: true });
    clearSession(res);
    return res;
  } catch (e) {
    console.error("[user/delete]", e);
    return NextResponse.json(
      { ok: false, message: "Kunde inte radera kontot. Försök igen." },
      { status: 500 },
    );
  }
}

function clearSession(res: NextResponse) {
  for (const name of ["nw_uid", "nw_last", "nw_group"]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}
