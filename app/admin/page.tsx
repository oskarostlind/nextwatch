// app/admin/page.tsx — admin-dashboard, endast för ADMIN_EMAIL (lib/adminAuth).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/adminAuth";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;

  // notFound (inte redirect till login) — sidan ska inte gå att upptäcka.
  if (!(await isAdmin(uid))) notFound();

  return <AdminClient />;
}
