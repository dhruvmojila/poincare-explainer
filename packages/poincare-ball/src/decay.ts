/**
 * Exponential half-life decay weight used for time-weighted embeddings:
 *
 *   w(Δt) = 2^(−Δt / halfLife) = exp(−ln 2 · Δt / halfLife)
 *
 * `age` and `halfLife` must be in the same unit (seconds, days, …).
 * Returns 1 for age <= 0 and tends to 0 as age grows. A non-positive `halfLife`
 * disables decay (weight 1) so callers can switch temporal weighting off.
 */
export function decayWeight(age: number, halfLife: number): number {
  if (!(halfLife > 0)) return 1;
  if (!(age > 0)) return 1;
  return Math.exp((-Math.LN2 * age) / halfLife);
}

/**
 * Ebbinghaus forgetting curve, R(Δt) = exp(−Δt / S), where S is the memory's
 * "stability": the age at which retention has fallen to 1/e. Non-positive `stability`
 * disables decay.
 */
export function ebbinghausWeight(age: number, stability: number): number {
  if (!(stability > 0)) return 1;
  if (!(age > 0)) return 1;
  return Math.exp(-age / stability);
}

/**
 * Validity window: full weight while the memory is younger than `window`, then a linear
 * fall to zero over `ramp` (a hard cut-off when `ramp` is 0). Non-positive `window`
 * disables the window (weight 1).
 */
export function validityWindowWeight(age: number, window: number, ramp = 0): number {
  if (!(window > 0)) return 1;
  if (!(age > window)) return 1;
  if (!(ramp > 0)) return 0;
  const over = age - window;
  return over >= ramp ? 0 : 1 - over / ramp;
}

export type DecayKind = 'half-life' | 'ebbinghaus' | 'window';

/**
 * Build a weight function w(age) for one of the three curves. `param` is the half-life,
 * the stability, or the window length respectively; `ramp` only applies to `window`.
 */
export function makeDecay(kind: DecayKind, param: number, ramp = 0): (age: number) => number {
  switch (kind) {
    case 'half-life':
      return (age) => decayWeight(age, param);
    case 'ebbinghaus':
      return (age) => ebbinghausWeight(age, param);
    case 'window':
      return (age) => validityWindowWeight(age, param, ramp);
    default:
      throw new RangeError(`unknown decay kind: ${String(kind)}`);
  }
}

/**
 * Retrieval score combining hyperbolic proximity and recency:
 *   score = exp(−d / scale) · decayWeight(age, halfLife)
 * Larger is better. `scale` sets how quickly geometric distance is penalised.
 */
export function timeWeightedScore(distance: number, age: number, halfLife: number, scale = 1): number {
  return Math.exp(-distance / scale) * decayWeight(age, halfLife);
}

/** Same as `timeWeightedScore` but with an already-computed recency weight in [0, 1]. */
export function weightedScore(distance: number, weight: number, scale = 1): number {
  return Math.exp(-distance / scale) * weight;
}
