#!/usr/bin/env node
/**
 * Runs a Prisma CLI command with DIRECT_URL normalised first.
 *
 * The schema declares `directUrl` so that migrations bypass the connection
 * pooler serverless needs. Prisma rejects that variable when it is present but
 * empty — exactly the shape a blank field in a hosting dashboard produces — and
 * the deploy fails with "You must provide a nonempty direct URL".
 *
 * A deployment without a separate unpooled connection is perfectly valid, so
 * rather than failing, fall back to DATABASE_URL and say so.
 *
 * Usage:  node scripts/prisma.mjs generate
 *         node scripts/prisma.mjs migrate deploy
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/prisma.mjs <prisma command...>');
  process.exit(1);
}

/** Reads a key from .env without overriding anything already in the environment. */
function fromDotEnv(key) {
  if (!existsSync('.env')) return undefined;
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match || match[1] !== key) continue;
      return match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // An unreadable .env is not this script's problem; Prisma will report it.
  }
  return undefined;
}

const present = (value) => typeof value === 'string' && value.trim().length > 0;

if (!present(process.env.DIRECT_URL)) {
  // An empty variable still shadows .env — dotenv never overwrites a key that
  // already exists — so the .env value has to be promoted explicitly.
  const fromFile = fromDotEnv('DIRECT_URL');

  if (present(fromFile)) {
    process.env.DIRECT_URL = fromFile;
  } else {
    const fallback = present(process.env.DATABASE_URL) ? process.env.DATABASE_URL : fromDotEnv('DATABASE_URL');

    if (present(fallback)) {
      process.env.DIRECT_URL = fallback;
      console.log(
        'DIRECT_URL is empty or unset — using DATABASE_URL for this command.\n' +
          '  If your database has a separate unpooled connection, set DIRECT_URL to it:\n' +
          '  migrations through a transaction-mode pooler can fail.',
      );
    }
  }
}

/**
 * npm puts node_modules/.bin on PATH, but this script is also run directly, so
 * resolve the local binary rather than trusting the environment.
 */
function prismaBinary() {
  const local = join('node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  return existsSync(local) ? local : 'prisma';
}

const binary = prismaBinary();
const result = spawnSync(binary, args, { stdio: 'inherit', shell: process.platform === 'win32' });

if (result.error) {
  console.error(`Could not run "${binary} ${args.join(' ')}": ${result.error.message}`);
  console.error('Is Prisma installed? Try `npm install`.');
  process.exit(1);
}

process.exit(result.status ?? 1);
