// Session tokens: a small HS256 JWT so a player stays logged in across a
// reload without sending the password again.
//
// No dependency: header and payload are base64url JSON, the signature is an
// HMAC-SHA256 over "header.payload" with a secret that lives in data/token.key.
// Changing that file logs everyone out, so it is never rotated casually.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** How long a token is valid. */
export const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type TokenPayload = {
  /** Account row id. */
  accountId: number;
  /** Account name, only for logging. */
  name: string;
  /** Expiry as a Unix timestamp in milliseconds. */
  exp: number;
};

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const sign = (data: string, secret: Buffer): string =>
  createHmac('sha256', secret).update(data).digest('base64url');

/** Builds a signed token for one account. */
export function signToken(accountId: number, name: string, secret: Buffer): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ accountId, name, exp: Date.now() + TOKEN_LIFETIME_MS });
  const signature = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

/** Returns the payload of a valid token, or null when it is broken or expired. */
export function verifyToken(token: string, secret: Buffer): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payloadPart, signaturePart] = parts;
  if (header === undefined || payloadPart === undefined || signaturePart === undefined) return null;

  const expected = Buffer.from(sign(`${header}.${payloadPart}`, secret), 'utf8');
  const given = Buffer.from(signaturePart, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    ) as Partial<TokenPayload>;

    if (typeof payload.accountId !== 'number' || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;

    return { accountId: payload.accountId, name: String(payload.name ?? ''), exp: payload.exp };
  } catch {
    return null;
  }
}

/** Reads the signing secret, creating it on first start. */
export function loadTokenSecret(file: string): Buffer {
  try {
    const existing = readFileSync(file);
    if (existing.length >= 32) return existing;
  } catch {
    // Missing: make one below.
  }

  const secret = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
