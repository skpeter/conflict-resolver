import type { PhaseSet, SeedSlot } from './types.ts'

export function pairKey(a: string, b: string): string {
  return BigInt(a) < BigInt(b) ? `${a}|${b}` : `${b}|${a}`
}

export function orderedPlayerIds(
  a: string,
  b: string,
): { lowerId: string; higherId: string } {
  return BigInt(a) < BigInt(b)
    ? { lowerId: a, higherId: b }
    : { lowerId: b, higherId: a }
}

function playersOnSet(set: PhaseSet): string[] {
  const ids: string[] = []
  for (const slot of set.slots) {
    if (slot.playerId) ids.push(slot.playerId)
  }
  return ids
}

/**
 * Pairs on the current bracket plus pairs a legal 1-2 slot move would create.
 */
export function buildPairList(
  sets: PhaseSet[],
  seeds: SeedSlot[],
): Array<{ a: string; b: string }> {
  const seen = new Set<string>()
  const out: Array<{ a: string; b: string }> = []

  function add(a: string, b: string) {
    if (a === b) return
    const key = pairKey(a, b)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ a, b })
  }

  for (const set of sets) {
    const ids = playersOnSet(set)
    if (ids.length === 2) add(ids[0], ids[1])
  }

  const ordered = [...seeds]
    .filter((s) => s.playerId && s.entrantId)
    .sort((x, y) => x.seedNum - y.seedNum)

  for (const seed of ordered) {
    for (const delta of [-2, -1, 1, 2] as const) {
      const mapping = applySeedShift(ordered, seed.seedNum, delta)
      if (!mapping) continue
      for (const set of sets) {
        const after = playersAfterMove(set, mapping)
        if (after.length === 2) add(after[0], after[1])
      }
    }
  }

  return out
}

/** Slide one entrant by ±1 or ±2 seed slots; people in between slide toward the vacated slot. */
export function applySeedShift(
  seeds: SeedSlot[],
  fromSeedNum: number,
  delta: -2 | -1 | 1 | 2,
): Map<number, SeedSlot> | null {
  const byNum = new Map(seeds.map((s) => [s.seedNum, s]))
  const mover = byNum.get(fromSeedNum)
  if (!mover?.playerId) return null
  const to = fromSeedNum + delta
  if (!byNum.has(to)) return null

  const nums = [...byNum.keys()].sort((a, b) => a - b)
  const result = new Map<number, SeedSlot>()
  for (const n of nums) result.set(n, byNum.get(n)!)

  const step = delta > 0 ? 1 : -1
  for (let n = fromSeedNum; n !== to; n += step) {
    result.set(n, byNum.get(n + step)!)
  }
  result.set(to, mover)
  return result
}

function playersAfterMove(
  set: PhaseSet,
  seedToHolder: Map<number, SeedSlot>,
): string[] {
  const ids: string[] = []
  for (const slot of set.slots) {
    if (slot.seedNum == null) continue
    const holder = seedToHolder.get(slot.seedNum)
    if (holder?.playerId) ids.push(holder.playerId)
  }
  return ids
}

export function hottestHeat(heats: number[]): number {
  if (heats.length === 0) return 0
  return Math.max(...heats)
}
