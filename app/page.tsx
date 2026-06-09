// app/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../lib/prisma";
import HeroReel from "./components/landing/HeroReel";
import LoginCard from "./components/auth/LoginCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;

  // Redan inloggad med verifierat konto + profil → hoppa över login (viktigt för iOS/Capacitor).
  if (uid) {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: {
        emailVerified: true,
        passwordHash: true,
        appleSub: true,
        profile: { select: { userId: true } },
      },
    });
    const hasAuth = Boolean(user?.passwordHash || user?.appleSub);
    if (user?.emailVerified && hasAuth && user?.profile) {
      redirect("/swipe");
    }
  }

  return (
    <div className="relative">
      {/* Komprimerad hero-reel */}
      <HeroReel durationMs={72000} heightClass="h-[180px] sm:h-[220px] md:h-[260px]" />

      {/* Innehåll i två kolumner för att undvika scroll */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 md:px-6 pt-6 md:pt-8 pb-6">
        <div className="grid items-start md:items-center gap-6 md:gap-8 md:grid-cols-2">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
              Hitta nästa film/serie – snabbt
            </h1>
            <p className="mt-2 text-neutral-300">
              Tinder-känsla för film &amp; serier. Bygg smakprofil, swipa solo eller i grupp.
            </p>
            <div className="mt-3 flex flex-wrap justify-center md:justify-start gap-2 text-xs md:text-sm text-white/80">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">Personliga tips</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">Grupp-swipe</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">Providers per region</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">Direktlänkar</span>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md">
            <LoginCard />
          </div>
        </div>
      </section>
    </div>
  );
}
