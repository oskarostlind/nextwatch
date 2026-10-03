"use client";

// Registrerar första besöket med källa (se lib/acquisition.ts). Gör ingenting
// om middleware inte just satt flaggan nw_src_new — dvs. en gång per
// webbläsare/app-installation, inte per sidvisning.
import { useEffect } from "react";
import { ACQ_NEW_FLAG } from "@/lib/acquisition";

export default function AcquisitionBeacon() {
  useEffect(() => {
    try {
      if (!document.cookie.split("; ").some((c) => c.startsWith(`${ACQ_NEW_FLAG}=1`))) return;
      void fetch("/api/track/visit", { method: "POST", keepalive: true }).catch(() => {});
    } catch {
      /* best effort */
    }
  }, []);
  return null;
}
