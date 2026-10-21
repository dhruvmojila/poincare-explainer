import { blake2b } from 'blakejs';
import type { Vec } from './math.js';

/**
 * Offline hashing embedder: a TypeScript port of the embedder the open-source reference
 * implementation (`poincare-memory`) uses when no neural encoder is available, so that a
 * query typed in the browser lands on exactly the vector the Python memory would compute.
 *
 *   1. lower-case the text; tokens are the matches of /[\p{L}\p{N}_']+/gu
 *   2. features: "w:" + token, and "c:" + g for every character n-gram g of "#" + token + "#"
 *      with n in [ngramMin, ngramMax] (code points, not UTF-16 units)
 *   3. each feature (UTF-8) is hashed with keyed BLAKE2b, digest 8 bytes, key = the seed as
 *      4 little-endian bytes
 *   4. index = first 4 digest bytes as a little-endian unsigned integer mod dim;
 *      sign = +1 if digest byte 4 is odd, else −1; the signs accumulate
 *   5. the row is L2-normalised (a text with no tokens is the zero vector)
 */
export interface HashingOptions {
  /** Vector dimension. Default 256. */
  dim?: number;
  /** Hash seed (the BLAKE2b key as 4 little-endian bytes). Default 0. */
  seed?: number;
  /** Inclusive character n-gram range. Default [3, 5]. */
  ngramRange?: [number, number];
}

export const HASHING_DEFAULTS: Required<HashingOptions> = { dim: 256, seed: 0, ngramRange: [3, 5] };

const TOKEN_RE = /[\p{L}\p{N}_']+/gu;
const encoder = new TextEncoder();

/** Lower-cased tokens of `text`: maximal runs of letters, digits, underscore and apostrophe. */
export function hashingTokens(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

/** Feature strings of `text` in the order the reference implementation emits them. */
export function hashingFeatures(text: string, ngramRange: [number, number] = HASHING_DEFAULTS.ngramRange): string[] {
  const [lo, hi] = ngramRange;
  const out: string[] = [];
  for (const tok of hashingTokens(text)) {
    out.push(`w:${tok}`);
    const chars = Array.from(`#${tok}#`);
    for (let n = lo; n <= hi; n++) {
      for (let i = 0; i + n <= chars.length; i++) out.push(`c:${chars.slice(i, i + n).join('')}`);
    }
  }
  return out;
}

/** The 4-byte little-endian key for `seed`. */
export function hashingKey(seed: number): Uint8Array {
  const key = new Uint8Array(4);
  const s = seed >>> 0;
  key[0] = s & 0xff;
  key[1] = (s >>> 8) & 0xff;
  key[2] = (s >>> 16) & 0xff;
  key[3] = (s >>> 24) & 0xff;
  return key;
}

/** Keyed BLAKE2b digest (8 bytes) of a feature string, UTF-8 encoded. */
export function hashingDigest(feature: string, seed = HASHING_DEFAULTS.seed): Uint8Array {
  return blake2b(encoder.encode(feature), hashingKey(seed), 8);
}

/** Lower-case hex of a digest (for debugging against the reference fixture). */
export function digestHex(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

/** (index, sign) of one feature. */
export function hashingSlot(feature: string, dim = HASHING_DEFAULTS.dim, seed = HASHING_DEFAULTS.seed): [number, 1 | -1] {
  const d = hashingDigest(feature, seed);
  const u = (d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0;
  return [u % dim, (d[4] & 1) === 1 ? 1 : -1];
}

/** Embed `text` as an L2-normalised vector of `dim` numbers. */
export function hashingEmbed(text: string, options: HashingOptions = {}): Vec {
  const dim = options.dim ?? HASHING_DEFAULTS.dim;
  const seed = options.seed ?? HASHING_DEFAULTS.seed;
  const ngramRange = options.ngramRange ?? HASHING_DEFAULTS.ngramRange;
  if (!Number.isInteger(dim) || dim <= 0) throw new RangeError(`dim must be a positive integer, got ${dim}`);
  const v = new Array<number>(dim).fill(0);
  for (const f of hashingFeatures(text, ngramRange)) {
    const [i, s] = hashingSlot(f, dim, seed);
    v[i] += s;
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  if (n > 0) {
    n = Math.sqrt(n);
    for (let i = 0; i < dim; i++) v[i] /= n;
  }
  return v;
}

/** Cosine similarity of two vectors (0 if either is zero). */
export function cosine(a: Vec, b: Vec): number {
  if (a.length !== b.length) throw new RangeError(`dimension mismatch: ${a.length} vs ${b.length}`);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}
