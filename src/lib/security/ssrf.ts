import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF protection for the website crawler.
 *
 * The crawler fetches operator-supplied URLs, so every request must be proven
 * to target a public internet host before a socket is opened. We check the
 * scheme, the hostname shape, and — critically — every resolved IP address,
 * because a public hostname can resolve to 127.0.0.1 or a cloud metadata
 * endpoint.
 */

export type UrlCheck = { ok: true; url: URL; addresses: string[] } | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.onion'];

/** Cloud metadata services — always refused regardless of DNS. */
const BLOCKED_ADDRESSES = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200']);

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const normalised = ip.toLowerCase().split('%')[0] ?? '';
  if (normalised === '::' || normalised === '::1') return true;
  if (normalised.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(normalised)) return true; // unique local
  if (normalised.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) must be judged by its IPv4 part.
  const mapped = normalised.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (BLOCKED_ADDRESSES.has(ip.toLowerCase())) return true;
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

function hostnameIsBlocked(hostname: string, extraBlocked: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (extraBlocked.some((blocked) => host === blocked.toLowerCase() || host.endsWith(`.${blocked.toLowerCase()}`)))
    return true;
  return false;
}

/**
 * Validates a URL and resolves its hostname, refusing anything that points at
 * a private, loopback, link-local or metadata address.
 */
export async function assertPublicUrl(rawUrl: string, extraBlockedHosts: string[] = []): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Malformed URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}"` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in URL are not allowed' };
  }
  if (!url.hostname) {
    return { ok: false, reason: 'Missing hostname' };
  }
  if (hostnameIsBlocked(url.hostname, extraBlockedHosts)) {
    return { ok: false, reason: 'Hostname is not a public internet host' };
  }

  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) {
    if (isBlockedAddress(literal)) return { ok: false, reason: 'IP address is not publicly routable' };
    return { ok: true, url, addresses: [literal] };
  }

  let addresses: string[];
  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    return { ok: false, reason: 'Hostname could not be resolved' };
  }

  if (addresses.length === 0) return { ok: false, reason: 'Hostname resolved to no addresses' };

  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) return { ok: false, reason: 'Hostname resolves to a non-public address' };

  return { ok: true, url, addresses };
}

/** Normalises user input like "example.com" into an absolute https URL. */
export function toAbsoluteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.toString();
  } catch {
    return null;
  }
}
