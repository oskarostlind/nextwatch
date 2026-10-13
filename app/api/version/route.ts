// app/api/version/route.ts
//
// GET → { sha } för bygget som just nu serverar sajten. VersionWatcher jämför
// med den sha som bakades in i klientens bygge (NEXT_PUBLIC_BUILD_SHA) och
// laddar om en klient som ligger efter.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "" },
    { headers: { "cache-control": "no-store" } },
  );
}
