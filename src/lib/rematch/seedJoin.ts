import type { PhaseSet, SeedSlot } from './types.ts'

/** When a slot has an entrant but no seed number, use that entrant's phase seed. */
export function fillMissingSeedNums(
  sets: PhaseSet[],
  seeds: SeedSlot[],
): PhaseSet[] {
  const byEntrant = new Map<string, number>()
  for (const seed of seeds) {
    if (seed.entrantId) byEntrant.set(seed.entrantId, seed.seedNum)
  }
  return sets.map((set) => ({
    ...set,
    slots: set.slots.map((slot) => {
      if (slot.seedNum != null || !slot.entrantId) return slot
      const seedNum = byEntrant.get(slot.entrantId)
      if (seedNum == null) return slot
      return { ...slot, seedNum }
    }),
  }))
}
