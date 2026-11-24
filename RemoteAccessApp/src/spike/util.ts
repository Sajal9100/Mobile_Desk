// SPIKE-ONLY (Milestone 1). THROWAWAY.

/**
 * Marks a promise as intentionally not awaited. Every async function the spike detaches handles its own
 * errors with try/catch; the catch here only stops an unexpected rejection from becoming "unhandled".
 */
export function detach(p: Promise<unknown>): void {
  p.catch(() => undefined);
}
