import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cosine, digestHex, hashingDigest, hashingEmbed, hashingFeatures, hashingKey, hashingSlot, hashingTokens } from '../src/index.js';

interface Fixture {
  dim: number;
  seed: number;
  ngram_range: [number, number];
  features_for_knee_flexion: string[];
  digests_for_first_features: Record<string, string>;
  vectors: Record<string, number[]>;
  cosine_pairs: Record<string, number>;
}

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/hashing-embedder-reference.json', import.meta.url)), 'utf8')) as Fixture;
const texts = Object.keys(fixture.vectors);

describe('hashing embedder (reference fixture)', () => {
  it('tokenises with the reference regex, lower-cased', () => {
    expect(hashingTokens('Knee Flexion')).toEqual(['knee', 'flexion']);
    expect(hashingTokens("API rate-limit's 250 req/s")).toEqual(['api', 'rate', "limit's", '250', 'req', 's']);
    expect(hashingTokens('')).toEqual([]);
    expect(hashingTokens('--- ...')).toEqual([]);
  });

  it('emits the fixture feature strings for "knee flexion" in order', () => {
    expect(hashingFeatures('knee flexion', fixture.ngram_range)).toEqual(fixture.features_for_knee_flexion);
  });

  it('keyed BLAKE2b digests match the fixture (8 bytes, key = 4-byte LE seed)', () => {
    expect(Array.from(hashingKey(0))).toEqual([0, 0, 0, 0]);
    expect(Array.from(hashingKey(0x01020304))).toEqual([4, 3, 2, 1]);
    for (const [feature, hex] of Object.entries(fixture.digests_for_first_features)) {
      expect(digestHex(hashingDigest(feature, fixture.seed))).toBe(hex);
    }
  });

  it('derives index and sign from the digest bytes', () => {
    // 'w:knee' → d7f63fe5 ba... : index = 0xe53ff6d7 mod 256 = 0xd7 = 215, byte 4 = 0xba (even) → −1
    expect(hashingSlot('w:knee', fixture.dim, fixture.seed)).toEqual([215, -1]);
    // 'c:kne' → 4bb67875 12... : index = 0x4b = 75, byte 4 = 0x12 (even) → −1
    expect(hashingSlot('c:kne', fixture.dim, fixture.seed)).toEqual([75, -1]);
    // 'c:#kn' → 3303258c 6b... : index = 0x33 = 51, byte 4 = 0x6b (odd) → +1
    expect(hashingSlot('c:#kn', fixture.dim, fixture.seed)).toEqual([51, 1]);
  });

  for (const text of texts) {
    it(`embeds "${text.slice(0, 32)}" to the reference vector (1e-6)`, () => {
      const v = hashingEmbed(text, { dim: fixture.dim, seed: fixture.seed, ngramRange: fixture.ngram_range });
      const ref = fixture.vectors[text];
      expect(v.length).toBe(ref.length);
      let maxErr = 0;
      for (let i = 0; i < v.length; i++) maxErr = Math.max(maxErr, Math.abs(v[i] - ref[i]));
      expect(maxErr).toBeLessThan(1e-6);
    });
  }

  it('reproduces the reference cosine pairs (1e-6)', () => {
    const vs = texts.map((t) => hashingEmbed(t, { dim: fixture.dim, seed: fixture.seed, ngramRange: fixture.ngram_range }));
    for (const [pair, ref] of Object.entries(fixture.cosine_pairs)) {
      const [a, b] = pair.split(',').map(Number);
      expect(Math.abs(cosine(vs[a], vs[b]) - ref)).toBeLessThan(1e-6);
    }
  });

  it('rows are unit length; empty text is the zero vector; defaults match the fixture', () => {
    const v = hashingEmbed('Gluteus maximus');
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 9);
    expect(v.length).toBe(256);
    expect(hashingEmbed('   ').every((x) => x === 0)).toBe(true);
    expect(hashingEmbed('knee flexion')).toEqual(hashingEmbed('knee flexion', { dim: fixture.dim, seed: fixture.seed, ngramRange: fixture.ngram_range }));
  });

  it('a different seed gives a different vector', () => {
    const a = hashingEmbed('knee flexion');
    const b = hashingEmbed('knee flexion', { seed: 7 });
    expect(cosine(a, b)).not.toBeCloseTo(1, 3);
  });
});
