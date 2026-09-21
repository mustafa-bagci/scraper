#!/usr/bin/env node
/**
 * Builds a `vercel.env` file ready to drop into Vercel's
 * "Import .env" box on Settings → Environment Variables.
 *
 * Usage:
 *   npm run vercel:env -- "<your Neon connection string>"
 *
 * Either Neon string works — pooled or direct. The script works out which one
 * you pasted, derives the other, and generates AUTH_SECRET for you.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const input = process.argv[2]?.trim();

if (!input) {
  console.error(`
Paste your Neon connection string as an argument:

  npm run vercel:env -- "postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"

Find it in Neon: your project → Connection string. Either the pooled or the
direct one — this script figures out the rest.
`);
  process.exit(1);
}

let url;
try {
  url = new URL(input);
} catch {
  console.error('That does not look like a connection string. It should start with postgresql://');
  process.exit(1);
}

if (!/^postgres(ql)?:$/.test(url.protocol)) {
  console.error(`Expected a postgresql:// URL, got "${url.protocol}"`);
  process.exit(1);
}

if (!url.hostname || !url.username) {
  console.error('That connection string is missing the host or the username — copy the whole line from Neon.');
  process.exit(1);
}

// Neon's pooled host is the direct host with "-pooler" inserted before the
// first dot. Everything else about the two strings is identical.
const isPooled = url.hostname.includes('-pooler.');
const pooledHost = isPooled ? url.hostname : url.hostname.replace('.', '-pooler.');
const directHost = isPooled ? url.hostname.replace('-pooler.', '.') : url.hostname;

const withHost = (host) => {
  const next = new URL(url.toString());
  next.hostname = host;
  return next.toString();
};

const authSecret = randomBytes(48).toString('base64');

const body = `# Murgay Lead Intelligence — Vercel environment
# Import this in Vercel: Settings -> Environment Variables -> Import .env
# Tick Production (and Preview if you use it).
#
# Generated ${new Date().toISOString()}
# Keep this file out of git — it contains your database password.

DATABASE_URL="${withHost(pooledHost)}"
DIRECT_URL="${withHost(directHost)}"
AUTH_SECRET="${authSecret}"
`;

writeFileSync('vercel.env', body, { mode: 0o600 });

const mask = (value) => value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••@');

console.log(`
Wrote vercel.env — import that file in Vercel.

  DATABASE_URL  ${mask(withHost(pooledHost))}
  DIRECT_URL    ${mask(withHost(directHost))}
  AUTH_SECRET   (generated, 64 chars)

You pasted the ${isPooled ? 'pooled' : 'direct'} string; the other was derived from it.
`);

if (pooledHost === directHost) {
  console.warn(
    'Note: this host has no separate pooler, so both URLs are the same. That works, but on\n' +
      'Neon make sure "Connection pooling" was enabled when you copied the string.\n',
  );
}
