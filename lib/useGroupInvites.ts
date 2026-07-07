'use client';

// Store-backad hook för gruppinbjudningar. Datan ägs av lib/socialStore.ts
// (en gemensam poller startad av SocialPreloader i AppShell) — den här hooken
// finns kvar som tunt API för befintliga konsumenter (IncomingInvites).

import { useSocial } from '@/app/components/client/SocialProvider';
import { refreshSocial, type GroupInviteItem, type SocialUser } from '@/lib/socialStore';

export type InviteUser = SocialUser;
export type Invite = GroupInviteItem;

export interface InviteList {
  ok: boolean;
  incoming: Invite[];
  outgoing: Invite[];
}

export function useGroupInvites() {
  const social = useSocial();

  const data: InviteList | null = social.invitesReady
    ? { ok: true, incoming: social.invitesIncoming, outgoing: social.invitesOutgoing }
    : null;

  return {
    data,
    loading: !social.invitesReady,
    error: null as string | null,
    /** Hämta om direkt (t.ex. efter accept/decline). */
    refresh: refreshSocial,
  };
}
