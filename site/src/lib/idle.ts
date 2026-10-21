/**
 * Idle scheduling for the start-up work that the hero does not need. Each call runs one short job
 * when the main thread is free (requestIdleCallback, with a timeout so it always runs); the caller
 * keeps every job well under a frame so that nothing becomes a long task on a slow phone.
 */
export function idle(fn: () => void, timeout = 400): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout });
  else window.setTimeout(fn, 32);
}

/** Resolves on the next idle period. */
export function nextIdle(timeout = 400): Promise<void> {
  return new Promise((resolve) => idle(resolve, timeout));
}
