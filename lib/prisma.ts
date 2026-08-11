// lib/prisma.ts
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Named export (ifall något i koden använder { prisma })
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({
    // log: ["query"], // slå på vid behov
  });

// Default export (så import prisma from "..." funkar)
export default prisma;

// Cache klienten i dev för att undvika många instanser vid HMR
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Kör en DB-läsning med omförsök vid Neon-kallstart.
 *
 * Neon skalar till noll: första anslutningen efter en paus kan misslyckas med
 * P1001 ("Can't reach database server") eller ett init-fel medan compute-noden
 * vaknar (~några hundra ms). Utan retry bubblar det upp som 500/"Internt fel"
 * till användaren — trots att exakt samma query lyckas en sekund senare.
 * Endast init-/P1001-fel försöks om; riktiga query-fel kastas direkt.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const init = e instanceof Prisma.PrismaClientInitializationError;
    const p1001 = (e as { code?: string })?.code === "P1001";
    if (retries > 0 && (init || p1001)) {
      await new Promise((r) => setTimeout(r, 700));
      return withDbRetry(fn, retries - 1);
    }
    throw e;
  }
}
