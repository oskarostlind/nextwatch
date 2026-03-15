"use client";

import { useEffect } from "react";
import MatchOverlay from "@/app/components/ui/MatchOverlay";
import { useGroupMatchPolling } from "@/lib/useGroupMatch";

export default function MatchOverlayMount() {
  const { open, item, dismiss, notifyVoted, groupCode } = useGroupMatchPolling();

  // Intercepta fetch → när /api/group/vote (POST) lyckas, trigga extra poll
  useEffect(() => {
    const originalFetch: typeof window.fetch = window.fetch.bind(window);

    function isVoteRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
      const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method : "GET");
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input instanceof Request
          ? input.url
          : "";
      return method === "POST" && url.includes("/api/group/vote");
    }

    const patched: typeof window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      try {
        if (res.ok && isVoteRequest(input, init)) {
          notifyVoted();
        }
      } catch {
        // noop
      }
      return res;
    };

    // Sätt patchat fetch
    (window as unknown as { fetch: typeof window.fetch }).fetch = patched;

    return () => {
      (window as unknown as { fetch: typeof window.fetch }).fetch = originalFetch;
    };
  }, [notifyVoted]);

  return <MatchOverlay open={open} item={item} onClose={dismiss} code={groupCode} />;
}
