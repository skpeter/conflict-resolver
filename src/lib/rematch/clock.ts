/** Window length in milliseconds: 60 * 24 hours. */
export const WINDOW_MS = 60 * 24 * 60 * 60 * 1000

export type ClockSource = {
  completedAt: number | null
  eventStartAt: number | null
}

/**
 * Clock for a set: completedAt is the hard truth.
 * If missing, event.startAt. If both missing, null (set does not count).
 */
export function setClock(source: ClockSource): {
  clockMs: number
  fromCompleted: boolean
} | null {
  if (source.completedAt != null) {
    return { clockMs: source.completedAt, fromCompleted: true }
  }
  if (source.eventStartAt != null) {
    return { clockMs: source.eventStartAt, fromCompleted: false }
  }
  return null
}

/**
 * Exact UTC age in days. Future clocks return null (ignored).
 * A clock equal to now is 0 days.
 */
export function ageDays(nowMs: number, clockMs: number): number | null {
  if (clockMs > nowMs) return null
  return (nowMs - clockMs) / 86_400_000
}

/** Inclusive window: at or under WINDOW_MS. One millisecond older does not count. */
export function inWindow(nowMs: number, clockMs: number): boolean {
  if (clockMs > nowMs) return false
  return nowMs - clockMs <= WINDOW_MS
}

/**
 * Pick the receipt among candidates inside the window.
 * Newer clock wins. Equal clocks prefer the completed set.
 */
export function pickReceiptClock(
  nowMs: number,
  candidates: Array<{ clockMs: number; fromCompleted: boolean }>,
): { clockMs: number; fromCompleted: boolean } | null {
  let best: { clockMs: number; fromCompleted: boolean } | null = null
  for (const c of candidates) {
    if (!inWindow(nowMs, c.clockMs)) continue
    if (ageDays(nowMs, c.clockMs) == null) continue
    if (!best) {
      best = c
      continue
    }
    if (c.clockMs > best.clockMs) {
      best = c
      continue
    }
    if (c.clockMs === best.clockMs && c.fromCompleted && !best.fromCompleted) {
      best = c
    }
  }
  return best
}
