"use client";

// Skriver om "Kolla nu"-länkar till en adress som tjänstens iOS-app tar emot.
//
// Prime Video: www.primevideo.com/search finns i deras apple-app-site-association,
// men Prime-appen har inte den domänen i sina associated domains — iOS öppnar
// därför Safari (testat på Oskars iPhone 2026-10-17: ingen "Öppna i Prime Video"
// vid långtryck). app.primevideo.com öppnar appen direkt, sökningen inräknad.
// Bara i iOS-appen: på webben (och utan Prime-appen) leder app.primevideo.com
// till Primes startsida och sökordet tappas, så där gäller www-länken.
//
// En lyssnare i capture-fasen i stället för att ändra lib/watchLinks.ts: länkarna
// byggs på flera ställen, även på servern (gruppmatchningen) där plattformen är
// okänd. Här skrivs href om precis innan klicket hinner navigera.

import { useEffect } from "react";
import { isNativeIos } from "@/lib/premiumPurchase";

const REWRITES: Array<{ from: RegExp; to: string }> = [
  { from: /^https:\/\/(?:www\.)?primevideo\.com\//i, to: "https://app.primevideo.com/" },
];

export function appLinkFor(href: string): string {
  for (const r of REWRITES) {
    if (r.from.test(href)) return href.replace(r.from, r.to);
  }
  return href;
}

export default function AppLinkRewriter() {
  useEffect(() => {
    if (!isNativeIos()) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const next = appLinkFor(a.href);
      if (next !== a.href) a.href = next;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
