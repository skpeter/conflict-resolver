import { computeHeat, formatHeat } from './heat.ts'
import { placementDropNotes } from './placement.ts'
import { applySeedShift, hottestHeat, pairKey } from './pairs.ts'
import { playerKeyOf, seedKeyOf } from './preview.ts'
import {
  projectBracket,
  projectedPlayerIds,
  projectedSlotText,
  type ProjectedSet,
} from './project.ts'
import { roundIndexTable } from './roundIndex.ts'
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
  rounds: Map<string, number>,
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
  const ri = rounds.get(row.set.id) ?? 1
  return {
    heat: computeHeat(days, ri, multipliers.recency, multipliers.round),
    failed: false,
  }
}

function heatsBySet(
  rows: ProjectedSet[],
  rounds: Map<string, number>,
  pairHeat: PairHeatLookup,
  daysByPair: Map<string, number>,
  multipliers: { recency: number; round: number },
): { heats: Map<string, number>; failed: boolean } {
  const heats = new Map<string, number>()
  for (const row of rows) {
    const heat = heatForRow(row, rounds, pairHeat, daysByPair, multipliers)
    if (heat.failed) return { heats, failed: true }
    heats.set(row.set.id, heat.heat)
  }
  return { heats, failed: false }
}

/** One line for a suggestion. The leftover bracket heat stays on the card, not here. */
export function describeSuggestedMove(move: SuggestedMove): string {
  const mover = `${move.entrantTag} (seed ${move.seedNumFrom})`
  const others = move.shifted
  let slide: string
  if (others.length === 1) {
    const partner = others[0]
    slide = `Swap ${mover} with ${partner.tag} (seed ${partner.seedNumFrom}).`
  } else {
    const chain = others
      .map((player) => `${player.tag} (seed ${player.seedNumFrom}) moves to seed ${player.seedNumTo}`)
      .join(', and ')
    slide = `Move ${mover} to seed ${move.seedNumTo}. ${chain}.`
  }
  if (move.setHeatBefore == null || move.setHeatAfter == null) return slide
  return `${slide} This set ${formatHeat(move.setHeatBefore)} → ${formatHeat(move.setHeatAfter)}.`
}

function playersWhoShift(
  ordered: SeedSlot[],
  from: number,
  delta: -2 | -1 | 1 | 2,
): Array<{ tag: string; seedNumFrom: number; seedNumTo: number }> {
  const byNum = new Map(ordered.map((seed) => [seed.seedNum, seed]))
  const to = from + delta
  const step = delta > 0 ? 1 : -1
  const others = []
  for (let n = from + step; n !== to + step; n += step) {
    const person = byNum.get(n)
    others.push({
      tag: person?.gamerTag ?? 'player',
      seedNumFrom: n,
      seedNumTo: n - step,
    })
  }
  return others
}

/** One line under the moves heading. Same leftover heat is stated once. */
export function describeMovesCard(moves: SuggestedMove[]): string {
  const low = Math.min(...moves.map((move) => move.newHottest))
  const high = Math.max(...moves.map((move) => move.newHottest))
  if (Math.abs(high - low) < 1e-9) {
    return `These moves cool this set. Hottest heat left on the bracket: ${formatHeat(low)}.`
  }
  return `These moves cool this set. Hottest heat left on the bracket is ${formatHeat(low)} to ${formatHeat(high)}, depending on the move.`
}

function sameBracket(
  mapping: Array<{ seedId: string; seedNum: number }>,
): string {
  return mapping
    .map((slot) => `${slot.seedId}@${slot.seedNum}`)
    .sort()
    .join(',')
}

/** Shown when a failed lookup would otherwise look like "no move cools this set". */
export const HISTORY_FAILED_MOVES =
  'History failed for a pair. Suggestions stay hidden until that retry succeeds.'

/** True when any pair lookup failed. Empty suggestions are not a finished answer. */
export function historyBlocksMoves(statuses: Iterable<string>): boolean {
  for (const status of statuses) {
    if (status === 'failed') return true
  }
  return false
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
  /**
   * When set, the move must cool this set. Another set may gain heat only
   * while that new heat stays below this set's current heat.
   */
  focusSetId?: string | null
  /** start.gg phase bracketType. Placement notes follow this format. */
  bracketType?: string | null
}): SuggestedMove[] {
  const {
    seeds,
    sets,
    pairHeat,
    daysByPair,
    recencyMultiplier = 1,
    roundMultiplier = 1,
    focusSetId = null,
    bracketType = null,
  } = args
  const multipliers = { recency: recencyMultiplier, round: roundMultiplier }
  const ordered = [...seeds]
    .filter((s) => s.entrantId)
    .sort((a, b) => a.seedNum - b.seedNum)

  if (focusSetId && !sets.some((set) => set.id === focusSetId)) return []

  const rounds = roundIndexTable(sets)
  const beforeRows = projectBracket(sets, seeds, null)
  const before = heatsBySet(beforeRows, rounds, pairHeat, daysByPair, multipliers)
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
      const after = heatsBySet(afterRows, rounds, pairHeat, daysByPair, multipliers)
      if (after.failed) continue

      const afterHeats: number[] = []
      const preview: PreviewRow[] = []
      const expected: BracketRow[] = []
      let worsened = false
      const focusBefore = focusSetId ? (before.heats.get(focusSetId) ?? 0) : 0
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
            focusAfter = heat
          } else if (heat > previousHeat + 1e-9 && !(heat < focusBefore - 1e-9)) {
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
            if (holder?.seedId === s.seedId) {
              seedNum = num
              break
            }
          }
          return { seedId: s.seedId, seedNum }
        })

      const shift = Math.abs(delta) as 1 | 2
      const shifted = playersWhoShift(ordered, seed.seedNum, delta)
      const seedNumTo = seed.seedNum + delta
      candidates.push({
        id: `${seed.seedId}:${seed.seedNum}->${seedNumTo}`,
        seedNumFrom: seed.seedNum,
        seedNumTo,
        entrantTag: seed.gamerTag ?? 'player',
        playerId: seed.playerId,
        shift,
        shifted,
        newHottest,
        setHeatBefore: focusSetId ? focusBefore : null,
        setHeatAfter: focusSetId ? focusAfter : null,
        placementNotes: placementDropNotes(bracketType, [
          {
            tag: seed.gamerTag ?? 'player',
            fromSeed: seed.seedNum,
            toSeed: seedNumTo,
          },
          ...shifted.map((player) => ({
            tag: player.tag,
            fromSeed: player.seedNumFrom,
            toSeed: player.seedNumTo,
          })),
        ]),
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

  const seen = new Set<string>()
  const unique: SuggestedMove[] = []
  for (const move of candidates) {
    const key = sameBracket(move.seedMapping)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(move)
  }
  return unique.slice(0, 3)
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
