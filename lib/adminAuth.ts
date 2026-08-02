// lib/adminAuth.ts
//
// Admin-gaten för /admin och /api/admin/*. Medvetet enklast möjliga modell:
// EN admin, utpekad via env ADMIN_EMAIL (sätts i Vercel). Ingen roll-kolumn i
// databasen — det finns bara en person som ska in här, och en env-var kan inte
// eskaleras via en komprometterad DB-rad. Saknas env-varen är gaten stängd för
// alla (fail closed).

import { prisma } from "@/lib/prisma";

export async function isAdmin(uid: string | null | undefined): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!uid || !adminEmail) return false;
  const u = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } });
  return Boolean(u?.email && u.email.toLowerCase() === adminEmail);
}
