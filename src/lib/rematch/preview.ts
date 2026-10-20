import type { PhaseSet } from './types.ts'

export type BracketRow = {
  seedKey: string
  players: string
  heat: number
}

export function seedKeyOf(set: Pick<PhaseSet, 'id' | 'slots'>): string {
  const nums = set.slots
    .map((slot) => slot.seedNum)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)
  if (nums.length === 0) return `id:${set.id}`
  return nums.join('|')
}

export function playerKeyOf(players: Array<string | null>): string {
  return players.map((player) => player ?? 'bye').join('|')
}

/**
 * True when the refreshed bracket's seeded sets disagree with the preview
 * that was sent. Sets with no seed number are not invented into the compare.
 */
export function bracketChanged(
  expected: BracketRow[],
  actual: BracketRow[],
): boolean {
  const exp = expected.filter((row) => !row.seedKey.startsWith('id:'))
  const actRows = actual.filter((row) => !row.seedKey.startsWith('id:'))
  if (exp.length !== actRows.length) return true
  const act = new Map(actRows.map((row) => [row.seedKey, row]))
  if (act.size !== actRows.length) return true
  for (const row of exp) {
    const found = act.get(row.seedKey)
    if (!found) return true
    if (found.players !== row.players) return true
    if (Math.abs(found.heat - row.heat) > 1e-6) return true
  }
  return false
}
