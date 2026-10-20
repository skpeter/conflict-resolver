import { inWindow } from './clock.ts'

export const HISTORY_PAGE_SIZE = 5
export const HISTORY_MAX_PAGES = 5

export type PageDecision = 'continue' | 'done' | 'incomplete'

/**
 * Walk at most 5 pages. Sort order is not promised, so an old page does not
 * end the walk early.
 * A short page ends the lookup.
 * A full fifth page with a clock still inside the window is incomplete.
 * A full fifth page already outside the window ends it. Earlier in-window
 * clocks stay the receipt.
 */
export function classifyHistoryPage(
  page: number,
  nodeCount: number,
  clocksMs: Array<number | null>,
  nowMs: number,
): PageDecision {
  if (nodeCount < HISTORY_PAGE_SIZE) return 'done'
  const inside = clocksMs.some((clock) => clock != null && inWindow(nowMs, clock))
  if (page >= HISTORY_MAX_PAGES) return inside ? 'incomplete' : 'done'
  return 'continue'
}
