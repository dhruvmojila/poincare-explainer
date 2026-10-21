# poincare-ball

Poincaré ball model of hyperbolic space in TypeScript (ESM; one runtime dependency,
[`blakejs`](https://www.npmjs.com/package/blakejs), for the hashing embedder).
Reference implementation accompanying

> D. Mojila, "LLM Orchestration with Geometry-Aware Memory," *2026 2nd International Conference on Big Data & Machine Learning (ICBDML)*, Bhopal, India, 27–28 Feb. 2026, pp. 1–7. DOI: [10.1109/ICBDML68582.2026.11544690](https://doi.org/10.1109/ICBDML68582.2026.11544690)

```ts
import { PoincareBall, sarkarLayout, geodesicArc, decayWeight, hashingEmbed, shellDistance } from 'poincare-ball';

const ball = new PoincareBall(1);           // curvature -1, unit ball
ball.distance([0.3, 0.1], [-0.2, 0.5]);     // gyrovector formula
ball.distanceArcosh([0.3, 0.1], [-0.2, 0.5]); // the paper's arcosh formula (same value)
ball.distanceToOrigin(ball.pointAt([1, 0], 2.5)); // 2.5

const layout = sarkarLayout({ id: 'body', children: [{ id: 'legs' }, { id: 'arms' }] }, { tau: 1 });
layout.get('legs')!.pos; // [x, y] with hyperbolic distance 1 from the origin

geodesicArc([0.5, 0.1], [-0.1, 0.6]); // { kind: 'arc', center, radius, startAngle, endAngle, anticlockwise }
decayWeight(ageDays, halfLifeDays);   // 2^(-age / halfLife)

const q = hashingEmbed('knee flexion');        // 256-d unit vector, same as the Python memory's offline embedder
shellDistance(q, hashingEmbed('knee'), 1);     // direction-only distance on the shell of radius 1
```

## API

`new PoincareBall(c = 1)` — ball of curvature −c (radius 1/√c).

| Method | Formula |
|---|---|
| `project(x)` | radial clamp to ‖x‖ ≤ (1 − 1e−5)/√c |
| `mobiusAdd(x, y)` | x ⊕_c y |
| `mobiusScalarMul(r, x)` | r ⊗_c x |
| `distance(x, y)` | (2/√c) artanh(√c ‖(−x) ⊕ y‖) |
| `distanceArcosh(x, y)` | (1/√c) arcosh(1 + 2c‖x−y‖² / ((1−c‖x‖²)(1−c‖y‖²))) |
| `distanceToOrigin(x)` | (2/√c) artanh(√c ‖x‖) |
| `expMap0(v)`, `logMap0(y)` | exponential / logarithmic map at the origin |
| `expMap(x, v)`, `logMap(x, y)` | exponential / logarithmic map at x |
| `geodesic(x, y, t)` | x ⊕ (t ⊗ ((−x) ⊕ y)) |
| `pointAt(direction, r)` | point at hyperbolic radius r, Euclidean norm tanh(√c r/2)/√c |
| `toLorentz(x)`, `fromLorentz(z)` | hyperboloid model with the same curvature |
| `conformalFactor(x)` | λ_x = 2/(1 − c‖x‖²) |

Functions: `geodesicArc(x, y, ball?)` (2-D: segment or boundary-orthogonal circle), `geodesicPolyline`, `sarkarLayout(tree, { tau, c | ball, rootAngle, fan })`, `flattenTree`, `placeBeyond(v, parent | null, tau, { ball, angleOffset })` (one Sarkar step for a single new node: the point at distance τ from v in the direction away from v's parent; used to attach a new memory one depth step beyond the node it is about).

Tilings (2-D): `regularTiling(p, q, depth, { c | ball, angle, maxNorm })` builds the regular {p,q} tiling by reflecting the central p-gon across its edges (tiles are congruent, q meet at each vertex); `reflectAcrossGeodesic(z, a, b, ball?)`; `tilingCircumradius(p, q)` (cosh r = cot(π/p) cot(π/q)); `tilingEdgeLength(p, q)` (cosh(s/2) = cos(π/p)/sin(π/q)).

Time weighting: `decayWeight(age, halfLife)` = 2^(−age/halfLife); `ebbinghausWeight(age, stability)` = e^(−age/S); `validityWindowWeight(age, window, ramp)`; `makeDecay(kind, param, ramp?)` returns w(age) for `'half-life' | 'ebbinghaus' | 'window'`; `timeWeightedScore(d, age, halfLife, scale?)` and `weightedScore(d, w, scale?)` = e^(−d/scale)·w.

Reference shell: `toShell(x, rho, ball?)` projects radially to hyperbolic radius ρ; `shellDistance(x, y, rho, ball?)` is the hyperbolic distance between the projections (depends on direction only, in any dimension); `shellSimilarity(x, y, rho, scale?, ball?)` = e^(−shellDistance/scale). This is how the open-source reference implementation compares a free-text query, which has no depth of its own, with stored memories before applying depth and ancestry as explicit structure.

Hashing embedder (`hashing.ts`, a port of the reference implementation's offline embedder, checked against its fixture to 1e−6): `hashingEmbed(text, { dim = 256, seed = 0, ngramRange = [3, 5] })` lower-cases the text, takes the tokens matched by `/[\p{L}\p{N}_']+/gu`, forms the features `w:` + token and `c:` + every character n-gram of `#` + token + `#` with n in the range, hashes each feature (UTF-8) with keyed BLAKE2b (digest 8 bytes, key = the seed as 4 little-endian bytes), uses the first 4 digest bytes (little-endian) mod `dim` as the index and the parity of byte 4 as the sign, accumulates and L2-normalises. Also exported: `hashingTokens`, `hashingFeatures`, `hashingKey`, `hashingDigest`, `hashingSlot`, `digestHex`, `cosine`, `HASHING_DEFAULTS`.

Layout metrics (`metrics.ts`): `indexTree(tree)` gives pre-order ids, parent/depth/children arrays, `hops(a, b)` (tree edges between two nodes) and `within(i, radius)`; `kNearest(i, n, k, dist)`; `neighbourPrecision(neighbours, relatives)`; `distortion(pairs, dEmbedded, dTree, tau)` = mean |d_embedded / (τ · d_tree) − 1|; `randomPairs(n, count, seed)` and `mulberry32(seed)` for reproducible sampling.

Numerical guards: artanh inputs clamped to ±(1 − 1e−15), tanh inputs to ±15, every returned point kept inside the ball with margin 1e−5.

## Licence

Apache-2.0. See `LICENSE`.

## Provenance

This page and the companion libraries are the author's open-source reference implementation and explanation of the method described in the paper. The system used for the paper's experiments is not released; everything here was written afterwards from the paper's description, and any numbers shown on this page come from the open-source code.
