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
