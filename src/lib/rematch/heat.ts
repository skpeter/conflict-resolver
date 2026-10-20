import type { HeatBand } from './types.ts'

export const HOT_THRESHOLD = 0.25

export function computeHeat(
  days: number,
  roundIndex: number,
  recencyMultiplier = 1,
  roundMultiplier = 1,
): number {
  const recency = (1 / (1 + days / 7)) ** recencyMultiplier
  const round = (1 / roundIndex ** 2) ** roundMultiplier
  return recency * round
}

export function heatBand(heat: number): HeatBand {
  if (heat >= HOT_THRESHOLD) return 'hot'
  if (heat > 0) return 'warm'
  return 'plain'
}
