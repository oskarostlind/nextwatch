"use client";

import type { GroupMemberItem } from "@/lib/socialStore";
import { useSocial } from "@/app/components/client/SocialProvider";

type Member = { userId: string; displayName: string; initials: string };

function toMember(m: GroupMemberItem): Member {
  const displayName = m.displayName ?? m.username ?? "Okänd";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  return { userId: m.id, displayName, initials };
}

type ShareCapableNavigator = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};

export default function GroupBar({ code }: { code: string }) {
  // Medlemmar från den delade social-store:n (global poller i AppShell)
  // istället för ett eget 15s-intervall.
  const social = useSocial();
  const members: Member[] =
    social.groupCode === code ? social.members.map(toMember) : [];

  const invite = async () => {
    const url = `${location.origin}/group/swipe?code=${encodeURIComponent(code)}`;
    try {
      const n = navigator as ShareCapableNavigator;
      if (typeof n.share === "function") {
        await n.share({ title: "NextWatch-grupp", text: `Gå med i min grupp: ${code}`, url });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        alert("Länk kopierad!");
        return;
      }
    } catch {
      // fallthrough to manual copy
    }
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("Länk kopierad!");
  };

  return (
    <div className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex w-full items-center justify-between px-4 py-2.5">
        <div className="text-sm font-semibold">Grupp: <span className="font-mono tracking-wider text-cyan-300">{code}</span></div>
        <div className="flex items-center gap-2">
          {members.map((m) => (
            <div key={m.userId} className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-neutral-200 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-900">{m.initials}</span>
              <span>{m.displayName}</span>
            </div>
          ))}
          <button onClick={invite} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-200 transition hover:bg-white/10">
            Bjud in
          </button>
        </div>
      </div>
    </div>
  );
}
