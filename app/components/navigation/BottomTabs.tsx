// app/components/navigation/BottomTabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../lib/nav";
import { motion } from "framer-motion";

export default function BottomTabs() {
  const pathname = usePathname();

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
              // Ändrat från flex-col till flex-row för att rymma pill-designen
              className="relative flex h-12 flex-row items-center justify-center text-[13px] font-medium"
            >
              {/* Animering för den aktiva bakgrunden ("pillen") */}
              {active && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute inset-0 rounded-full bg-white"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}

              <div
                className={[
                  "relative z-10 flex items-center gap-1.5 px-4 transition-colors",
                  active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-300",
                ].join(" ")}
              >
                <Icon className={active ? "h-5 w-5" : "h-6 w-6"} />
                {/* Visa bara texten om fliken är aktiv */}
                {active && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {item.short}
                  </motion.span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}