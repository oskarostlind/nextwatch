// app/components/navigation/BottomTabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../lib/nav";
import { motion } from "framer-motion";
import { useSocial } from "../client/SocialProvider";
import { useShareThreads } from "@/lib/threadsStore";

export default function BottomTabs() {
  const pathname = usePathname();

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
          const active =
            pathname === item.href ||
            (item.activeStartsWith !== "/" && pathname.startsWith(item.activeStartsWith));

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              data-guide={item.guideTarget}
              className="relative flex h-12 w-12 items-center justify-center"
            >
              {/* Animering för den aktiva bakgrunden ("pillen") – ikon-only, ingen text */}
              {active && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute inset-0 rounded-full bg-white"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}

              <Icon
                className={[
                  "relative z-10 h-6 w-6 transition-colors",
                  active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-300",
                ].join(" ")}
              />

              {item.href === "/group" && groupBadge > 0 && (
                <span className="absolute right-1 top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold text-black">
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