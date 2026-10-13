// app/components/navigation/BottomTabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../lib/nav";
import { useTranslations } from "next-intl";
import { useSocial } from "../client/SocialProvider";
import { useShareThreads } from "@/lib/threadsStore";

export default function BottomTabs() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  // Optimistisk aktiv-markering: flytta den redan vid trycket i stället för när
  // navigeringen är klar — fliken KÄNNS omedelbar även om RSC-svaret dröjer.
  //
  // Sätts på click, INTE på pointerdown: ett pointerdown som aldrig blir ett
  // tryck (fingret dras bort igen, eller tabbraden nuddas av misstag) startar
  // ingen navigering, så pathname ändras aldrig och markeringen skulle bli kvar på
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
    // Platt, tyst chrome (2026-10-13): bakgrunden smälter in i sidan och bara en
    // hårfin kant skiljer raden från innehållet — fyra ikoner, inte fyra knappar.
    <div className="sticky bottom-0 z-20 border-t border-white/[0.04] bg-neutral-950/90 backdrop-blur">
      <div
        // Målet för nav-hinten (lib/tours/coachSteps.ts NAV_TOUR_STEPS) — hela
        // raden pekas ut i EN ruta i stället för en modal per flik.
        data-tour="nav-tabs"
        className="mx-auto flex max-w-3xl items-center justify-around px-2 pt-1 pb-[calc(env(safe-area-inset-bottom)+4px)]"
      >
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
                // i den här vyn — då ska markeringen inte flytta sig heller.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                setPending(item.href);
              }}
              aria-label={t(item.labelKey)}
              aria-current={active ? "page" : undefined}
              // 44 px hög och 64 px bred: tryckytan är större än ikonen så
              // tummen inte behöver sikta, fast raden ser smalare ut.
              className="group relative flex h-11 w-16 items-center justify-center rounded-xl transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
            >
              <Icon
                aria-hidden
                className={[
                  "h-6 w-6 transition-[color,transform] duration-100 group-active:scale-90",
                  active ? "text-white" : "text-neutral-500 hover:text-neutral-300",
                ].join(" ")}
              />

              {/* Aktiv flik = vit ikon + en liten prick under. Ingen pill och
                  ingen layoutId-animation: markeringen ska synas, inte röra sig. */}
              <span
                aria-hidden
                className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white transition-opacity duration-150 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />

              {item.href === "/group" && groupBadge > 0 && (
                <span className="absolute left-1/2 top-0.5 z-20 ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold tabular-nums text-black">
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