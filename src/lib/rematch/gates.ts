/** A response draws only when its load generation is still the current one. */
export function shouldApplyGeneration(
  responseGen: number,
  currentGen: number,
): boolean {
  return responseGen === currentGen
}

/**
 * First click claims the write. A second click while that claim is held
 * does not send.
 */
export function claimWrite(state: { inFlight: boolean }): boolean {
  if (state.inFlight) return false
  state.inFlight = true
  return true
}

export function isAuthError(message: string): boolean {
  return /auth|permission|forbidden|unauthorized|token/i.test(message)
}

/** A replaced load must not leave pairs on "checking" after the walk stops. */
export function abandonCheckingPairs<T extends { status: string }>(
  pairs: Map<string, T>,
  failed: T,
): Map<string, T> {
  let changed = false
  const next = new Map(pairs)
  for (const [key, state] of pairs) {
    if (state.status !== 'checking') continue
    next.set(key, failed)
    changed = true
  }
  return changed ? next : pairs
}
