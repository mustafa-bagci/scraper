import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * Unauthenticated liveness/readiness probe (excluded from the auth
 * middleware). It reports database reachability and nothing else — no
 * configuration, no versions, no provider details.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: 'up' });
  } catch {
    return NextResponse.json({ ok: false, database: 'down' }, { status: 503 });
  }
}
