/**
 * Identifier and secret generation.
 *
 * Tenant and board IDs are opaque and random rather than sequential: a
 * predictable ID would let anyone enumerate every customer on the platform by
 * counting upward, and board IDs appear in shareable mirror and overlay URLs.
 *
 * Pure except for `crypto.getRandomValues`, which exists in browsers and in
 * Node 18+, so this module is shared by the web app and the Cloud Functions.
 */

/**
 * Crockford-style alphabet with `i`, `l`, `o` and `u` removed, so an ID read
 * aloud over a gym PA or copied off a screen does not turn into a support ticket.
 */
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Draws `length` characters uniformly from `alphabet`.
 *
 * Rejection sampling rather than a plain modulo: with an alphabet size that does
 * not divide 256 evenly, `byte % size` quietly biases the low characters, which
 * shrinks the effective key space of anything used as a secret.
 */
function randomString(length: number, alphabet: string): string {
  const size = alphabet.length;
  const limit = Math.floor(256 / size) * size;
  let out = '';
  const buffer = new Uint8Array(length * 2);

  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (out.length === length) break;
      if (byte < limit) out += alphabet[byte % size];
    }
  }
  return out;
}

/** 12 random characters ≈ 60 bits — far past guessing, still short enough to read. */
export function generateTenantId(): string {
  return `tnt_${randomString(12, ID_ALPHABET)}`;
}

export function generateBoardId(): string {
  return `brd_${randomString(12, ID_ALPHABET)}`;
}

export function generateInviteId(): string {
  return `inv_${randomString(20, ID_ALPHABET)}`;
}

/**
 * A viewer key for a mirror or overlay URL.
 *
 * 43 characters of a 64-symbol alphabet is ~256 bits. These travel in URLs that
 * get pasted into OBS and left on venue machines for months, and only their
 * SHA-256 hash is ever stored, so the key itself must be far beyond brute force.
 */
export function generateViewerKey(): string {
  return randomString(43, KEY_ALPHABET);
}

/** Slug for display and vanity URLs. Never used for authorisation. */
export function slugify(input: string, fallback = 'board'): string {
  const slug = input
    .toLowerCase()
    // NFKD splits accented letters into base + combining mark; the next replace
    // then drops the marks along with every other non-alphanumeric character.
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug === '' ? fallback : slug;
}

const ID_PATTERN = /^(tnt|brd|inv)_[0-9abcdefghjkmnpqrstvwxyz]{12,20}$/;

/** Cheap shape check before an ID is used in a path or a query. */
export function isValidId(id: unknown, prefix?: 'tnt' | 'brd' | 'inv'): boolean {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false;
  return prefix ? id.startsWith(`${prefix}_`) : true;
}

const VIEWER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidViewerKey(key: unknown): key is string {
  return typeof key === 'string' && VIEWER_KEY_PATTERN.test(key);
}
