import { computeHeat } from './heat.ts'
import { applySeedShift, hottestHeat, pairKey } from './pairs.ts'
import { playerKeyOf, seedKeyOf } from './preview.ts'
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

function labelFor(
  seedNum: number | null,
  holder: SeedSlot | undefined,
): string {
  if (!holder?.playerId) {
    if (seedNum == null) return 'bye (no seed)'
    return 'bye'
  }
  return `${holder.gamerTag ?? 'player'} (seed ${seedNum})`
}

function playersForSet(
  set: PhaseSet,
  seedToHolder: Map<number, SeedSlot> | null,
): Array<string | null> {
  return set.slots.map((slot) => {
    if (seedToHolder && slot.seedNum != null) {
      return seedToHolder.get(slot.seedNum)?.playerId ?? null
    }
    return slot.playerId
  })
}

function heatForPlayers(
  players: Array<string | null>,
  set: PhaseSet,
  allSets: PhaseSet[],
  pairHeat: PairHeatLookup,
  daysByPair: Map<string, number>,
  multipliers: { recency: number; round: number },
): { heat: number; failed: boolean } {
  const filled = players.filter((p): p is string => Boolean(p))
  if (filled.length !== 2) return { heat: 0, failed: false }
  const lookup = pairHeat(filled[0], filled[1])
  if ('failed' in lookup) return { heat: 0, failed: true }
  if ('missing' in lookup) return { heat: 0, failed: false }
  const days = daysByPair.get(pairKey(filled[0], filled[1]))
  if (days == null) return { heat: lookup.heat, failed: false }
  const ri = roundIndex(set, allSets)
  return {
    heat: computeHeat(days, ri, multipliers.recency, multipliers.round),
    failed: false,
  }
}

export function listSuggestedMoves(args: {
  seeds: SeedSlot[]
  sets: PhaseSet[]
  pairHeat: PairHeatLookup
  daysByPair: Map<string, number>
  recencyMultiplier?: number
  roundMultiplier?: number
}): SuggestedMove[] {
  const {
    seeds,
    sets,
    pairHeat,
    daysByPair,
    recencyMultiplier = 1,
    roundMultiplier = 1,
  } = args
  const multipliers = { recency: recencyMultiplier, round: roundMultiplier }
  const ordered = [...seeds]
    .filter((s) => s.entrantId)
    .sort((a, b) => a.seedNum - b.seedNum)

  const currentHeats: number[] = []
  for (const set of sets) {
    const h = heatForPlayers(
      playersForSet(set, null),
      set,
      sets,
      pairHeat,
      daysByPair,
      multipliers,
    )
    if (h.failed) continue
    currentHeats.push(h.heat)
  }
  const currentHottest = hottestHeat(currentHeats)

  const candidates: SuggestedMove[] = []

  for (const seed of ordered) {
    if (!seed.playerId) continue
    for (const delta of [-2, -1, 1, 2] as const) {
      const mapping = applySeedShift(ordered, seed.seedNum, delta)
      if (!mapping) continue

      let failed = false
      const afterHeats: number[] = []
      const preview: PreviewRow[] = []
      const expected: BracketRow[] = []

      for (const set of sets) {
        const beforePlayers = playersForSet(set, null)
        const afterPlayers = playersForSet(set, mapping)
        const before = heatForPlayers(
          beforePlayers,
          set,
          sets,
          pairHeat,
          daysByPair,
          multipliers,
        )
        const after = heatForPlayers(
          afterPlayers,
          set,
          sets,
          pairHeat,
          daysByPair,
          multipliers,
        )
        if (before.failed || after.failed) {
          failed = true
          break
        }
        afterHeats.push(after.heat)
        expected.push({
          seedKey: seedKeyOf(set),
          players: playerKeyOf(afterPlayers),
          heat: after.heat,
        })

        const changed = set.slots.some((_, i) => beforePlayers[i] !== afterPlayers[i])
        if (!changed) continue

        const beforeFilled = beforePlayers.filter(Boolean).length
        const afterFilled = afterPlayers.filter(Boolean).length
        let kind: PreviewRow['kind'] = 'heat'
        if ((beforeFilled < 2) !== (afterFilled < 2)) kind = 'bye-changed'
        else if (beforeFilled < 2 && afterFilled < 2) kind = 'bye-other'

        const beforeLabels = set.slots.map((slot) =>
          labelFor(
            slot.seedNum,
            slot.seedNum != null
              ? ordered.find((s) => s.seedNum === slot.seedNum)
              : undefined,
          ),
        )
        const afterLabels = set.slots.map((slot) =>
          labelFor(
            slot.seedNum,
            slot.seedNum != null ? mapping.get(slot.seedNum) : undefined,
          ),
        )

        preview.push({
          setId: set.id,
          before: beforeLabels.join(' vs '),
          after: afterLabels.join(' vs '),
          kind,
          oldHeat: kind === 'heat' ? before.heat : 0,
          newHeat: kind === 'heat' ? after.heat : 0,
        })
      }

      if (failed) continue
      const newHottest = hottestHeat(afterHeats)
      if (!(newHottest < currentHottest)) continue

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
