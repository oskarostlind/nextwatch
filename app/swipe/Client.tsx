"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Legacy from "./_legacy";

export default function Client() {
  const r = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // se till att vi har nw_uid cookie
      await fetch("/api/session/init", { cache: "no-store" }).catch(() => {});
      const s = await fetch("/api/profile/status", { cache: "no-store" }).then((x) => x.json());
      if (!alive) return;
      if (!s?.hasSession) { setReady(true); return; }
      if (!s?.hasProfile) { r.replace("/onboarding"); return; }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [r]);

  if (!ready) return <div className="p-6 text-neutral-400">Laddar…</div>;
  return <Legacy />;
}
