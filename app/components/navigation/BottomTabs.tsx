// app/components/navigation/BottomTabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../lib/nav";
import { motion } from "framer-motion";
import { useSocial } from "../client/SocialProvider";
import { useShareThreads } from "@/lib/threadsStore";

export default function BottomTabs() {
  const pathname = usePathname();

  // Optimistisk aktiv-pill: flytta pillen redan vid trycket i stället för när
  // navigeringen är klar — fliken KÄNNS omedelbar även om RSC-svaret dröjer.
  //
  // Sätts på click, INTE på pointerdown: ett pointerdown som aldrig blir ett
  // tryck (fingret dras bort igen, eller tabbraden nuddas av misstag) startar
  // ingen navigering, så pathname ändras aldrig och pillen skulle bli kvar på
  // fel flik tills nästa navigering. click fyras bara vid ett fullbordat tryck
  // och ligger ändå före routerns arbete, så hela vinsten är kvar.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname]);

  // Oläst-badge på Grupp-fliken: vänförfrågningar + gruppinbjudningar (från
  // social-storen) + olästa filmchattar (delade threads-storen — en poll för
  // hela appen; tidigare hade den här komponenten en egen som dessutom
  // resettade intervallet på varje route-byte).
  const social = useSocial();
  const { threads } = useShareThreads();
  const unseenChats = threads.reduce((sum, t) => sum + t.unseen, 0);

  const groupBadge =
    social.pendingIn.length + social.invitesIncoming.length + unseenChats;

  return (
    // Behåller ditt z-20 och backdrop-blur
    <div className="sticky bottom-0 z-20 border-t border-neutral-800/80 bg-neutral-900/70 backdrop-blur">
      {/* Justera grid och padding för att få plats med den växande pill-fliken.
        Flexbox är ofta lättare än grid här eftersom barnen ändrar storlek.
      */}
      <div className="mx-auto flex max-w-3xl items-center justify-around gap-1 px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {navItems.map((item) => {
          const Icon = item.icon;
          // Om din pathname är exakt item.href ELLER (om activeStartsWith är satt) börjar på item.activeStartsWith.
          // Säkerställ att start-rutten ('/') inte matchar allt av misstag.
          // Med en pending-flik (nyss tryckt) vinner den optimistiska markeringen.
          const active = pending
            ? item.href === pending
            : pathname === item.href ||
              (item.activeStartsWith !== "/" && pathname.startsWith(item.activeStartsWith));

          return (
            <Link
              key={item.href}
              href={item.href}
              // Prefetch:a hela RSC-payloaden vid idle så första trycket
              // serveras ur router-cachen (bundet: 5 flikar per staleTimes-fönster).
              prefetch={true}
              onClick={(e) => {
                // Modifierat klick (öppna i ny flik på webben) navigerar inte
                // i den här vyn — då ska pillen inte flytta sig heller.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                setPending(item.href);
              }}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              data-guide={item.guideTarget}
              className="group relative flex h-12 w-12 items-center justify-center rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
            >
              {/* Animering för den aktiva bakgrunden ("pillen") – ikon-only, ingen text.
                  Kritiskt dämpad fjäder — snärtig utan studs. */}
              {active && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute inset-0 rounded-full bg-white"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}

              <Icon
                className={[
                  "relative z-10 h-6 w-6 transition-[color,transform] duration-100 group-active:scale-90",
                  active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-300",
                ].join(" ")}
              />

              {item.href === "/group" && groupBadge > 0 && (
                <span className="absolute right-1 top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold tabular-nums text-black">
                  {groupBadge > 9 ? "9+" : groupBadge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}