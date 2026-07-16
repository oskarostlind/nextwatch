// app/coming-soon/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import ComingSoonClient from "./ComingSoonClient";

export default function ComingSoonPage() {
  return <ComingSoonClient />;
}
