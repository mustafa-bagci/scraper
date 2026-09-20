import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { getEnv } from '@/lib/env';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const SCRYPT_PARAMS = 'scrypt$32768$8$1';

/** Hashes a password with scrypt. Plain-text passwords are never stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${SCRYPT_PARAMS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, , , , saltB64, hashB64] = parts as [string, string, string, string, string, string];
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password, salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(`${getEnv().AUTH_SECRET}:provider-secrets`).digest();
}

/**
 * Encrypts a provider API key for storage. Secrets are decrypted only inside
 * server code that is about to call the provider — never serialised to a
 * client component or an API response.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string): string | null {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Last four characters of a secret, safe to display in the UI. */
export function secretHint(plain: string): string {
  if (plain.length <= 4) return '••••';
  return `••••${plain.slice(-4)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
