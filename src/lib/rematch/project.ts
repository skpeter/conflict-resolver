import type { PhaseSet, SeedSlot, SetSlot } from './types.ts'

export type ProjectedPlayer = {
  kind: 'player'
  playerId: string
  entrantId: string | null
  gamerTag: string | null
  seedNum: number | null
  /** True when this entrant was not already seated on the set slot. */
  projected: boolean
}

export type ProjectedSlot =
  | ProjectedPlayer
  | { kind: 'bye' }
  | { kind: 'unresolved' }

export type ProjectedSet = {
  set: PhaseSet
  slots: ProjectedSlot[]
  /** Two entrants, so the set can carry a rematch heat. */
  scoreable: boolean
  /** At least one entrant was forecast onto an empty slot. */
  projected: boolean
}

type Outcome = {
  winner: ProjectedPlayer
  loser: ProjectedPlayer | null
  /** True when the winner is the better seed, not a reported result or a bye. */
  assumed: boolean
}

const EMPTY_OUTCOME: Outcome | null = null

function isByePrereq(prereqType: string | null): boolean {
  if (!prereqType) return false
  return /bye/i.test(prereqType)
}

function isResetSet(set: PhaseSet): boolean {
  return /reset/i.test(set.fullRoundText ?? '')
}

function playerFromSlot(slot: SetSlot, seedNum: number | null): ProjectedPlayer | null {
  if (!slot.playerId) return null
  return {
    kind: 'player',
    playerId: slot.playerId,
    entrantId: slot.entrantId,
    gamerTag: slot.gamerTag,
    seedNum: slot.seedNum ?? seedNum,
    projected: false,
  }
}

function playerFromSeed(
  seed: SeedSlot,
  seedNum: number,
  projected: boolean,
): ProjectedPlayer | null {
  if (!seed.playerId) return null
  return {
    kind: 'player',
    playerId: seed.playerId,
    entrantId: seed.entrantId,
    gamerTag: seed.gamerTag,
    seedNum,
    projected,
  }
}

/**
 * Fill empty bracket slots from Start.gg's prerequisite graph.
 * A reported winner is kept. An unresolved match advances the better
 * (lower) seed. Byes, missing links, cycles, and reset sets stay empty.
 * `seedToHolder` is the bracket after a hypothetical seed slide.
 */
export function projectBracket(
  sets: PhaseSet[],
  seeds: SeedSlot[],
  seedToHolder?: Map<number, SeedSlot> | null,
): ProjectedSet[] {
  const byId = new Map(sets.map((set) => [set.id, set]))
  const seedsByPlayer = new Map<string, number>()
  for (const seed of seeds) {
    if (seed.playerId) seedsByPlayer.set(seed.playerId, seed.seedNum)
  }
  const seedsByNum = new Map(seeds.map((seed) => [seed.seedNum, seed]))
  const seedsById = new Map(seeds.map((seed) => [seed.seedId, seed]))
  const mapping = seedToHolder ?? null
  const memo = new Map<string, { slots: ProjectedSlot[]; outcome: Outcome | null }>()
  const stack = new Set<string>()

  function seedNumFor(playerId: string, slotSeed: number | null): number | null {
    if (slotSeed != null) return slotSeed
    return seedsByPlayer.get(playerId) ?? null
  }

  function holderAt(seedNum: number): SeedSlot | undefined {
    if (mapping) return mapping.get(seedNum)
    return seedsByNum.get(seedNum)
  }

  function positionOf(seed: SeedSlot): number {
    if (mapping) {
      for (const [num, holder] of mapping) {
        if (holder.seedId === seed.seedId) return num
      }
    }
    return seed.seedNum
  }

  function unresolvedSlots(set: PhaseSet): ProjectedSlot[] {
    return set.slots.map(() => ({ kind: 'unresolved' as const }))
  }

  function outcomeFrom(set: PhaseSet, slots: ProjectedSlot[]): Outcome | null {
    const players = slots.filter((slot): slot is ProjectedPlayer => slot.kind === 'player')
    if (set.winnerId) {
      const winner = players.find((player) => player.entrantId === set.winnerId)
      if (!winner) return EMPTY_OUTCOME
      const loser = players.find((player) => player.playerId !== winner.playerId) ?? null
      return { winner: { ...winner, projected: false }, loser, assumed: false }
    }
    if (slots.some((slot) => slot.kind === 'unresolved')) return EMPTY_OUTCOME
    if (players.length === 1) {
      return { winner: players[0], loser: null, assumed: false }
    }
    if (players.length !== 2) return EMPTY_OUTCOME
    const [a, b] = players
    if (a.seedNum == null || b.seedNum == null || a.seedNum === b.seedNum) {
      return EMPTY_OUTCOME
    }
    const winner = a.seedNum < b.seedNum ? a : b
    const loser = winner === a ? b : a
    return {
      winner: { ...winner, projected: true },
      loser: { ...loser, projected: true },
      assumed: true,
    }
  }

  function placed(slot: SetSlot): ProjectedSlot {
    if (mapping && slot.seedNum != null) {
      const holder = holderAt(slot.seedNum)
      if (!holder?.playerId) return { kind: 'bye' }
      const player = playerFromSeed(
        holder,
        slot.seedNum,
        holder.playerId !== slot.playerId,
      )
      return player ?? { kind: 'bye' }
    }
    if (slot.playerId) {
      const player = playerFromSlot(slot, seedNumFor(slot.playerId, slot.seedNum))
      return player ?? { kind: 'unresolved' }
    }
    if (slot.seedNum != null) {
      const holder = holderAt(slot.seedNum)
      if (!holder?.playerId) return { kind: 'bye' }
      const player = playerFromSeed(holder, slot.seedNum, true)
      return player ?? { kind: 'bye' }
    }
    if (slot.entrantId && !slot.playerId) return { kind: 'unresolved' }
    return { kind: 'bye' }
  }

  function resolveSlot(set: PhaseSet, slot: SetSlot): ProjectedSlot {
    if (isByePrereq(slot.prereqType)) {
      if (!mapping && slot.playerId) {
        const player = playerFromSlot(slot, seedNumFor(slot.playerId, slot.seedNum))
        return player ?? { kind: 'bye' }
      }
      return { kind: 'bye' }
    }
    if (slot.prereqType && /^seed$/i.test(slot.prereqType)) {
      const seed = slot.prereqId ? seedsById.get(slot.prereqId) : undefined
      if (!seed?.playerId) return { kind: 'unresolved' }
      const player = playerFromSeed(
        seed,
        positionOf(seed),
        !slot.playerId || seed.playerId !== slot.playerId,
      )
      return player ?? { kind: 'unresolved' }
    }
    if (slot.prereqId) {
      // start.gg omits a bye set and seats the advancer on the next slot.
      if (!byId.has(slot.prereqId)) {
        if (slot.playerId || slot.seedNum != null) return placed(slot)
        return { kind: 'unresolved' }
      }
      if (!mapping && slot.playerId) {
        const player = playerFromSlot(slot, seedNumFor(slot.playerId, slot.seedNum))
        return player ?? { kind: 'unresolved' }
      }
      if (set.winnerId && slot.playerId) {
        const player = playerFromSlot(slot, seedNumFor(slot.playerId, slot.seedNum))
        return player ?? { kind: 'unresolved' }
      }
      const prev = resolve(slot.prereqId)
      const placement = slot.prereqPlacement
      if (placement === 1 && prev.outcome?.winner) {
        const winner = prev.outcome.winner
        return {
          ...winner,
          projected: slot.playerId !== winner.playerId,
        }
      }
      if (placement === 2 && prev.outcome?.loser) {
        const loser = prev.outcome.loser
        return {
          ...loser,
          projected: slot.playerId !== loser.playerId,
        }
      }
      return { kind: 'unresolved' }
    }
    return placed(slot)
  }

  function resolve(id: string): { slots: ProjectedSlot[]; outcome: Outcome | null } {
    const cached = memo.get(id)
    if (cached) return cached
    const set = byId.get(id)
    if (!set || stack.has(id)) {
      return { slots: [], outcome: EMPTY_OUTCOME }
    }
    if (isResetSet(set)) {
      const resolved = { slots: unresolvedSlots(set), outcome: EMPTY_OUTCOME }
      memo.set(id, resolved)
      return resolved
    }
    stack.add(id)
    let slots: ProjectedSlot[]
    if (set.winnerId) {
      slots = set.slots.map((slot) => {
        if (isByePrereq(slot.prereqType) && !slot.playerId) return { kind: 'bye' as const }
        if (slot.playerId) {
          const player = playerFromSlot(slot, seedNumFor(slot.playerId, slot.seedNum))
          return player ?? { kind: 'unresolved' as const }
        }
        return { kind: 'unresolved' as const }
      })
    } else {
      slots = set.slots.map((slot) => resolveSlot(set, slot))
    }
    const resolved = { slots, outcome: outcomeFrom(set, slots) }
    stack.delete(id)
    memo.set(id, resolved)
    return resolved
  }

  return sets.map((set) => {
    const resolved = resolve(set.id)
    const slots =
      resolved.slots.length === set.slots.length
        ? resolved.slots
        : unresolvedSlots(set)
    const players = slots.filter((slot) => slot.kind === 'player')
    return {
      set,
      slots,
      scoreable: players.length === 2,
      projected: slots.some((slot) => slot.kind === 'player' && slot.projected),
    }
  })
}

export function projectedSlotText(slot: ProjectedSlot): string {
  if (slot.kind === 'bye') return 'bye'
  if (slot.kind === 'unresolved') return 'unresolved'
  const tag = slot.gamerTag ?? 'player'
  return slot.seedNum != null ? `${tag} (seed ${slot.seedNum})` : tag
}

export function projectedPlayerIds(slots: ProjectedSlot[]): string[] {
  return slots
    .filter((slot): slot is ProjectedPlayer => slot.kind === 'player')
    .map((slot) => slot.playerId)
}
