import { PrismaClient } from '@prisma/client';

/**
 * The schema declares `directUrl`, and the client rejects that variable when it
 * is present but blank — the shape a hosting dashboard produces from an empty
 * field. The running app never uses the direct connection (only `prisma
 * migrate` does), so a blank one is normalised away before the client is
 * constructed rather than being allowed to take the deployment down.
 *
 * `scripts/prisma.mjs` does the same for CLI commands; the two cannot share
 * code because that one runs before any TypeScript is compiled.
 */
if (typeof process.env.DIRECT_URL === 'string' && process.env.DIRECT_URL.trim() === '') {
  const fallback = process.env.DATABASE_URL;
  if (typeof fallback === 'string' && fallback.trim() !== '') process.env.DIRECT_URL = fallback;
  else delete process.env.DIRECT_URL;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
