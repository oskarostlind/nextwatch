// app/api/admin/users/[id]/route.ts — full profil för EN användare i admin-vyn.
//
// Konto, profil (smak, tjänster, språk), aktivitetsräknare, senaste swipes med
// titlar, grupper, och relationen till dig (vän / väntande förfrågan) så att
// "Lägg till vän"-knappen kan visa rätt läge. Endast läsning — att lägga till
// som vän går via den vanliga /api/friends/request (du är ju inloggad som dig).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";
import { tmdbDetails, type TmdbType } from "@/lib/tmdbDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FavTitle = { title?: string; name?: string; year?: string | number | null; poster?: string | null } | null;

function favLabel(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const f = v as NonNullable<FavTitle>;
  const t = f.title ?? f.name;
  if (!t) return null;
  return f.year ? `${t} (${f.year})` : t;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(me))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      username: true,
      plan: true,
      planSince: true,
      subProvider: true,
      subStatus: true,
      subCurrentPeriodEnd: true,
      emailVerified: true,
      createdAt: true,
      lastLoginAt: true,
      lastActiveAt: true,
      appleSub: true,
      passwordHash: true,
      termsAcceptedAt: true,
      profile: {
        select: {
          displayName: true,
          avatarId: true,
          dob: true,
          uiLanguage: true,
          region: true,
          providers: true,
          favoriteGenres: true,
          dislikedGenres: true,
          favoriteMovie: true,
          favoriteShow: true,
          swipeMediaFilter: true,
          showKidsContent: true,
          notifyDailyRecs: true,
          notifyMarketing: true,
        },
      },
      _count: {
        select: {
          ratings: true,
          watchlist: true,
          pushTokens: true,
          groupMembers: true,
          friendshipsAsUser: true,
          friendshipsAsFriend: true,
          purchases: true,
          appleIapTransactions: true,
        },
      },
    },
  });
  if (!user) return NextResponse.json({ ok: false, message: "Användaren finns inte." }, { status: 404 });

  const [decisions, recent, groups, friendship, pending] = await Promise.all([
    prisma.rating.groupBy({ by: ["decision"], where: { userId: id }, _count: { _all: true } }),
    prisma.rating.findMany({
      where: { userId: id },
      orderBy: { decidedAt: "desc" },
      take: 12,
      select: { tmdbId: true, mediaType: true, decision: true, rating: true, decidedAt: true },
    }),
    prisma.groupMember.findMany({
      where: { userId: id },
      orderBy: { joinedAt: "desc" },
      take: 10,
      select: { groupCode: true, joinedAt: true, group: { select: { _count: { select: { members: true } } } } },
    }),
    me && me !== id
      ? prisma.friendship.findFirst({
          where: { OR: [{ userId: me, friendId: id }, { userId: id, friendId: me }] },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
    me && me !== id
      ? prisma.friendRequest.findFirst({
          where: {
            status: { in: ["pending", "blocked"] },
            OR: [
              { fromUserId: me, toUserId: id },
              { fromUserId: id, toUserId: me },
            ],
          },
          select: { fromUserId: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  // Titlarna för de senaste swipesen — best effort, en miss blir "#id".
  const recentTitles = await Promise.all(
    recent.map(async (r) => {
      const d = await tmdbDetails(r.mediaType as TmdbType, r.tmdbId, "sv-SE").catch(() => null);
      return {
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        decision: r.decision,
        rating: r.rating,
        decidedAt: r.decidedAt.toISOString(),
        title: d?.title ?? `#${r.tmdbId}`,
        year: d?.year ?? null,
        poster: d?.poster ? `https://image.tmdb.org/t/p/w154${d.poster}` : null,
      };
    }),
  );

  let relation: "self" | "friends" | "outgoing" | "incoming" | "blocked" | "none" = "none";
  if (me === id) relation = "self";
  else if (friendship) relation = "friends";
  else if (pending?.status === "blocked") relation = "blocked";
  else if (pending) relation = pending.fromUserId === me ? "outgoing" : "incoming";

  const p = user.profile;
  const providers = Array.isArray(p?.providers) ? (p?.providers as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const age = p?.dob ? Math.floor((Date.now() - p.dob.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;

  return NextResponse.json({
    ok: true,
    relation,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: p?.displayName ?? null,
      avatarId: p?.avatarId ?? null,
      plan: user.plan,
      planSince: user.planSince?.toISOString() ?? null,
      subProvider: user.subProvider,
      subStatus: user.subStatus,
      subCurrentPeriodEnd: user.subCurrentPeriodEnd?.toISOString() ?? null,
      verified: Boolean(user.emailVerified),
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      loginMethods: [user.appleSub ? "Apple" : null, user.passwordHash ? "E-post" : null].filter(Boolean),
      termsAccepted: Boolean(user.termsAcceptedAt),
      hasProfile: Boolean(p),
      age,
      uiLanguage: p?.uiLanguage ?? null,
      region: p?.region ?? null,
      providers,
      favoriteGenres: p?.favoriteGenres ?? [],
      dislikedGenres: p?.dislikedGenres ?? [],
      favoriteMovie: favLabel(p?.favoriteMovie),
      favoriteShow: favLabel(p?.favoriteShow),
      swipeMediaFilter: p?.swipeMediaFilter ?? null,
      showKidsContent: p?.showKidsContent ?? null,
      notifyDailyRecs: p?.notifyDailyRecs ?? null,
      pushDevices: user._count.pushTokens,
    },
    counts: {
      ratings: user._count.ratings,
      watchlist: user._count.watchlist,
      groups: user._count.groupMembers,
      friends: user._count.friendshipsAsUser + user._count.friendshipsAsFriend,
      purchases: user._count.purchases + user._count.appleIapTransactions,
      decisions: Object.fromEntries(decisions.map((d) => [d.decision, d._count._all])),
    },
    recent: recentTitles,
    groups: groups.map((g) => ({
      code: g.groupCode,
      joinedAt: g.joinedAt.toISOString(),
      members: g.group?._count.members ?? 0,
    })),
  });
}
