"use client";

import { useEffect, useRef } from "react";
import MatchOverlay, { type GroupMatchItem } from "../ui/MatchOverlay";
import { useGroupMatchPolling } from "../../../lib/useGroupMatch";

export default function OverlayMount() {
  const { open, item, dismiss, notifyVoted, groupCode } = useGroupMatchPolling();

  // Sticky-minne: om vi får ett item när overlayn inte hunnit mounta,
  // behåll det så att vi kan visa direkt när allt är redo.
  const lastItemRef = useRef<GroupMatchItem | null>(null);
  if (open && item) {
    lastItemRef.current = item;
  }
  const shownItem = item ?? lastItemRef.current;

  // Intercepta fetch → när /api/group/vote (POST) lyckas, trigga extra poll
  useEffect(() => {
    const originalFetch: typeof window.fetch = window.fetch.bind(window);

    function isVoteRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
      const method =
        init?.method?.toUpperCase() ?? (input instanceof Request ? input.method : "GET");
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

    (window as unknown as { fetch: typeof window.fetch }).fetch = patched;
    return () => {
      (window as unknown as { fetch: typeof window.fetch }).fetch = originalFetch;
    };
  }, [notifyVoted]);

  return <MatchOverlay open={open} item={shownItem} onClose={dismiss} code={groupCode} />;
}
