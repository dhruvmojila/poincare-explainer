export { PoincareBall } from './ball.js';
export { geodesicArc, geodesicPolyline } from './arc.js';
export type { GeodesicArc, Vec2 } from './arc.js';
export { sarkarLayout, flattenTree, placeBeyond } from './sarkar.js';
export type { TreeNode, SarkarOptions, LayoutNode, SarkarLayout } from './sarkar.js';
export { decayWeight, ebbinghausWeight, validityWindowWeight, makeDecay, timeWeightedScore, weightedScore } from './decay.js';
export type { DecayKind } from './decay.js';
export { regularTiling, reflectAcrossGeodesic, tilingCircumradius, tilingEdgeLength } from './tiling.js';
export type { Tile, TilingOptions } from './tiling.js';
export { toShell, shellDistance, shellSimilarity } from './shell.js';
export { hashingEmbed, hashingFeatures, hashingTokens, hashingKey, hashingDigest, hashingSlot, digestHex, cosine, HASHING_DEFAULTS } from './hashing.js';
export type { HashingOptions } from './hashing.js';
export { indexTree, kNearest, neighbourPrecision, distortion, randomPairs, mulberry32 } from './metrics.js';
export type { TreeIndex } from './metrics.js';
export {
  artanh,
  tanh,
  arcosh,
  clamp,
  dot,
  norm,
  normSq,
  add,
  sub,
  scale,
  neg,
  normalize,
  zeros,
  ARTANH_CLAMP,
  TANH_CLAMP,
  BALL_MARGIN,
} from './math.js';
export type { Vec } from './math.js';
