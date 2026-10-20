import type { PhaseSet, SetSlot } from './types.ts'

function isByePrereq(prereqType: string | null): boolean {
  if (!prereqType) return false
  return /bye/i.test(prereqType)
}

function priorWins(
  slot: SetSlot,
  setsById: Map<string, PhaseSet>,
  visiting: Set<string>,
): number {
  const prereqId = slot.prereqId
  if (!prereqId) return 0
  if (isByePrereq(slot.prereqType)) return 0
  if (visiting.has(prereqId)) return 0
  const prev = setsById.get(prereqId)
  if (!prev) return 0
  visiting.add(prereqId)
  const child = prev.slots.map((slot) => priorWins(slot, setsById, visiting))
  visiting.delete(prereqId)
  const deeper = child.length === 0 ? 0 : Math.min(...child)
  return 1 + deeper
}

function baseRoundIndex(set: PhaseSet, allSets: PhaseSet[]): number {
  const byId = new Map(allSets.map((s) => [s.id, s]))
  const counts = set.slots.map((slot) => priorWins(slot, byId, new Set()))
  const smaller = counts.length === 0 ? 0 : Math.min(...counts)
  return 1 + smaller
}

function winnersFinalIndex(allSets: PhaseSet[]): number | null {
  let best: number | null = null
  for (const set of allSets) {
    const text = set.fullRoundText ?? ''
    if (!/winners?\s+final/i.test(text)) continue
    if (/grand/i.test(text)) continue
    const idx = baseRoundIndex(set, allSets)
    if (best == null || idx > best) best = idx
  }
  return best
}

export function roundIndex(set: PhaseSet, allSets: PhaseSet[]): number {
  const text = set.fullRoundText ?? ''
  if (/grand final reset/i.test(text)) {
    const gf = allSets.find((s) => {
      const t = s.fullRoundText ?? ''
      return /grand final/i.test(t) && !/reset/i.test(t)
    })
    if (gf) return roundIndex(gf, allSets) + 1
    return baseRoundIndex(set, allSets)
  }
  if (/grand final/i.test(text)) {
    const wf = winnersFinalIndex(allSets)
    if (wf != null) return wf + 1
  }
  return baseRoundIndex(set, allSets)
}
