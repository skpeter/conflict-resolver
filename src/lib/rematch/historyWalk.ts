import { inWindow } from './clock.ts'

export const HISTORY_PAGE_SIZE = 5
export const HISTORY_MAX_PAGES = 5

/** How many pages cover the same set budget after a page shrinks. */
export function historyPageLimit(
  pageSize: number,
  budgetPageSize = HISTORY_PAGE_SIZE,
): number {
  const size = Math.max(1, pageSize)
  const budget = HISTORY_MAX_PAGES * Math.max(1, budgetPageSize)
  return Math.max(HISTORY_MAX_PAGES, Math.ceil(budget / size))
}

export type PageDecision = 'continue' | 'done' | 'incomplete'

/**
 * Walk at most 5 pages. Sort order is not promised, so an old page does not
 * end the walk early.
 * A short page ends the lookup.
 * A full last page with a clock still inside the window is incomplete.
 * A full last page already outside the window ends it. Earlier in-window
 * clocks stay the receipt. A smaller page raises the page cap so the walk
 * still covers the original set budget.
 */
export function classifyHistoryPage(
  page: number,
  nodeCount: number,
  clocksMs: Array<number | null>,
  nowMs: number,
  pageSize = HISTORY_PAGE_SIZE,
  maxPages = HISTORY_MAX_PAGES,
): PageDecision {
  if (nodeCount < pageSize) return 'done'
  const inside = clocksMs.some((clock) => clock != null && inWindow(nowMs, clock))
  if (page >= maxPages) return inside ? 'incomplete' : 'done'
  return 'continue'
}
