import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(s?: string | null, keep = 6) {
  if (!s) return null;
  const head = s.slice(0, keep);
  const tail = s.length > keep ? `...(${s.length})` : "";
  return `${head}${tail}`;
}

export async function GET() {
  const v4 = process.env.TMDB_V4_TOKEN || null;
  const v3 = process.env.TMDB_API_KEY || null;
  const iapKey = process.env.APPLE_IAP_PRIVATE_KEY || null;

  return NextResponse.json({
    ok: true,
    has_v4: !!v4,
    v4_preview: mask(v4),   // visar bara första tecknen + längd
    has_v3: !!v3,
    v3_preview: mask(v3),
    apple_iap: {
      configured: Boolean(
        process.env.APPLE_IAP_PREMIUM_MONTHLY &&
          process.env.APPLE_IAP_KEY_ID &&
          process.env.APPLE_IAP_ISSUER_ID &&
          iapKey
      ),
      product: process.env.APPLE_IAP_PREMIUM_MONTHLY ?? null,
      issuer_preview: mask(process.env.APPLE_IAP_ISSUER_ID, 8),
      key_id_preview: mask(process.env.APPLE_IAP_KEY_ID, 4),
      private_key_length: iapKey?.length ?? 0,
      bundle_id: process.env.APPLE_IAP_BUNDLE_ID ?? "com.nextwatch.app",
    },
  });
}
