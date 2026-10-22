import { computeHeat } from './heat.ts'
import { applySeedShift, hottestHeat, pairKey } from './pairs.ts'
import { playerKeyOf, seedKeyOf } from './preview.ts'
import {
  projectBracket,
  projectedPlayerIds,
  projectedSlotText,
  type ProjectedSet,
} from './project.ts'
import { roundIndex } from './roundIndex.ts'
import type {
  BracketRow,
} from './preview.ts'
import type {
  PhaseSet,
  PreviewRow,
  SeedSlot,
  SuggestedMove,
} from './types.ts'

export type PairHeatLookup = (
  a: string,
  b: string,
) => { ok: true; heat: number } | { failed: true } | { missing: true }

function heatForRow(
  row: ProjectedSet,
  allSets: PhaseSet[],
  pairHeat: PairHeatLookup,
  daysByPair: Map<string, number>,
  multipliers: { recency: number; round: number },
): { heat: number; failed: boolean } {
  if (!row.scoreable) return { heat: 0, failed: false }
  const filled = projectedPlayerIds(row.slots)
  if (filled.length !== 2) return { heat: 0, failed: false }
  const lookup = pairHeat(filled[0], filled[1])
  if ('failed' in lookup) return { heat: 0, failed: true }
  if ('missing' in lookup) return { heat: 0, failed: false }
  const days = daysByPair.get(pairKey(filled[0], filled[1]))
  if (days == null) return { heat: lookup.heat, failed: false }
  const ri = roundIndex(row.set, allSets)
  return {
    heat: computeHeat(days, ri, multipliers.recency, multipliers.round),
    failed: false,
  }
}

function heatsBySet(
  rows: ProjectedSet[],
  sets: PhaseSet[],
  pairHeat: PairHeatLookup,
  daysByPair: Map<string, number>,
  multipliers: { recency: number; round: number },
): { heats: Map<string, number>; failed: boolean } {
  const heats = new Map<string, number>()
  for (const row of rows) {
    const heat = heatForRow(row, sets, pairHeat, daysByPair, multipliers)
    if (heat.failed) return { heats, failed: true }
    heats.set(row.set.id, heat.heat)
  }
  return { heats, failed: false }
}

/** Suggestions stay hidden until the organizer selects one set. */
export function movesForSelectedSet<T>(
  selectedSetId: string | null,
  moves: T[],
): T[] {
  if (!selectedSetId) return []
  return moves
}

export function listSuggestedMoves(args: {
  seeds: SeedSlot[]
  sets: PhaseSet[]
  pairHeat: PairHeatLookup
  daysByPair: Map<string, number>
  recencyMultiplier?: number
  roundMultiplier?: number
  /** When set, the move must cool this set and must not heat any other set. */
  focusSetId?: string | null
}): SuggestedMove[] {
  const {
    seeds,
    sets,
    pairHeat,
    daysByPair,
    recencyMultiplier = 1,
    roundMultiplier = 1,
    focusSetId = null,
  } = args
  const multipliers = { recency: recencyMultiplier, round: roundMultiplier }
  const ordered = [...seeds]
    .filter((s) => s.entrantId)
    .sort((a, b) => a.seedNum - b.seedNum)

  if (focusSetId && !sets.some((set) => set.id === focusSetId)) return []

  const beforeRows = projectBracket(sets, seeds, null)
  const before = heatsBySet(beforeRows, sets, pairHeat, daysByPair, multipliers)
  if (before.failed) return []
  const currentHeats: number[] = []
  for (const row of beforeRows) {
    const heat = before.heats.get(row.set.id)
    if (heat == null) continue
    currentHeats.push(heat)
  }
  const currentHottest = hottestHeat(currentHeats)
  const beforeById = new Map(beforeRows.map((row) => [row.set.id, row]))

  const candidates: SuggestedMove[] = []

  for (const seed of ordered) {
    if (!seed.playerId) continue
    for (const delta of [-2, -1, 1, 2] as const) {
      const mapping = applySeedShift(ordered, seed.seedNum, delta)
      if (!mapping) continue

      const afterRows = projectBracket(sets, seeds, mapping)
      const after = heatsBySet(afterRows, sets, pairHeat, daysByPair, multipliers)
      if (after.failed) continue

      const afterHeats: number[] = []
      const preview: PreviewRow[] = []
      const expected: BracketRow[] = []
      let worsened = false
      let focusBefore = 0
      let focusAfter = 0
      let focusSeen = false

      for (const row of afterRows) {
        const heat = after.heats.get(row.set.id) ?? 0
        afterHeats.push(heat)
        const previous = beforeById.get(row.set.id)
        const previousHeat = before.heats.get(row.set.id) ?? 0
        const afterIds = row.slots.map((slot) =>
          slot.kind === 'player' ? slot.playerId : null,
        )
        const beforeIds = (previous?.slots ?? []).map((slot) =>
          slot.kind === 'player' ? slot.playerId : null,
        )
        expected.push({
          seedKey: seedKeyOf(row.set),
          players: playerKeyOf(afterIds),
          heat,
        })

        if (focusSetId) {
          if (row.set.id === focusSetId) {
            focusSeen = true
            focusBefore = previousHeat
            focusAfter = heat
          } else if (heat > previousHeat + 1e-9) {
            worsened = true
          }
        }

        const beforeKey = playerKeyOf(beforeIds)
        const afterKey = playerKeyOf(afterIds)
        if (beforeKey === afterKey) continue

        const beforeFilled = beforeIds.filter(Boolean).length
        const afterFilled = afterIds.filter(Boolean).length
        let kind: PreviewRow['kind'] = 'heat'
        if ((beforeFilled < 2) !== (afterFilled < 2)) kind = 'bye-changed'
        else if (beforeFilled < 2 && afterFilled < 2) kind = 'bye-other'

        preview.push({
          setId: row.set.id,
          before: (previous?.slots ?? []).map(projectedSlotText).join(' vs '),
          after: row.slots.map(projectedSlotText).join(' vs '),
          kind,
          oldHeat: kind === 'heat' ? previousHeat : 0,
          newHeat: kind === 'heat' ? heat : 0,
        })
      }

      if (focusSetId) {
        if (!focusSeen || worsened) continue
        if (!(focusAfter < focusBefore - 1e-9)) continue
      }

      const newHottest = hottestHeat(afterHeats)
      if (!focusSetId && !(newHottest < currentHottest)) continue

      const seedMapping = [...seeds]
        .sort((a, b) => a.seedNum - b.seedNum)
        .map((s) => {
          let seedNum = s.seedNum
          for (const [num, holder] of mapping) {
            if (holder.seedId === s.seedId) {
              seedNum = num
              break
            }
          }
          return { seedId: s.seedId, seedNum }
        })

      const shift = Math.abs(delta) as 1 | 2
      candidates.push({
        id: `${seed.seedNum}->${seed.seedNum + delta}`,
        seedNumFrom: seed.seedNum,
        seedNumTo: seed.seedNum + delta,
        entrantTag: seed.gamerTag ?? 'player',
        playerId: seed.playerId,
        shift,
        newHottest,
        seedMapping,
        preview,
        expected,
      })
    }
  }

  candidates.sort((a, b) => {
    if (a.newHottest !== b.newHottest) return a.newHottest - b.newHottest
    if (a.shift !== b.shift) return a.shift - b.shift
    return a.seedNumFrom - b.seedNumFrom
  })

  return candidates.slice(0, 3)
}

/**
 * Unstarted means PENDING / missing / CREATED(1), no winner, no reported game.
 * ACTIVE, READY, CALLED, COMPLETED, or anything else hides the write button.
 */
export function phaseIsUnstarted(sets: PhaseSet[]): boolean {
  for (const set of sets) {
    if (set.winnerId) return false
    if (set.hasReportedGames) return false
    const state = set.state
    if (state == null || state === '' || state === 'PENDING' || state === 1) {
      continue
    }
    return false
  }
  return true
}
