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

/** The stored score stays 0–1. Organizers see that score as a percent. */
export function formatHeat(heat: number): string {
  const percent = Math.round(heat * 100)
  if (heat > 0 && percent <= 0) return '<1%'
  if (percent >= 100) return '100%'
  return `${Math.max(0, percent)}%`
}
