"use client";

// Monteras i app/swipe/page_client.tsx (solo-leken). Visar rätt steg i
// "nya flödet" ovanpå leken. Varje steg är en egen fil och äger sin egen UI;
// se docs/nya-flodet.md för kontraktet.

import { useFirstSession } from "@/lib/firstSession";
import AiReveal from "./AiReveal";
import SaveSheet from "./SaveSheet";
import SoftPaywall from "./SoftPaywall";
import PushAskSheet from "./PushAskSheet";
import InviteCard from "./InviteCard";

export default function FirstSessionHost() {
  const fs = useFirstSession();
  if (!fs.eligible) return null;
  switch (fs.step) {
    case "ai":
      return <AiReveal fs={fs} />;
    case "save":
      return <SaveSheet fs={fs} />;
    case "paywall":
      return <SoftPaywall fs={fs} />;
    case "push":
      return <PushAskSheet fs={fs} />;
    case "invite":
      return <InviteCard fs={fs} />;
    default:
      return null;
  }
}
