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

/** Dark panel → red → logo orange. Matches --color-surface / heat-mid / heat-1. */
const HEAT_STOP_0 = { r: 20, g: 20, b: 20 }
const HEAT_STOP_MID = { r: 255, g: 90, b: 74 }
const HEAT_STOP_1 = { r: 255, g: 140, b: 0 }

/** Same curve as CSS ease-in-out: linger at the ends, move through the mid faster. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function mix(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): string {
  return `rgb(${lerpChannel(from.r, to.r, t)}, ${lerpChannel(from.g, to.g, t)}, ${lerpChannel(from.b, to.b, t)})`
}

function heatProgress(heat: number): number {
  return easeInOut(Math.min(1, Math.max(0, heat)))
}

/** Continuous fill for a 0–1 heat score. Plain rows (heat ≤ 0) stay unfilled. */
export function heatFill(heat: number): string {
  if (!(heat > 0)) return 'transparent'
  const t = heatProgress(heat)
  if (t <= 0.5) return mix(HEAT_STOP_0, HEAT_STOP_MID, t / 0.5)
  return mix(HEAT_STOP_MID, HEAT_STOP_1, (t - 0.5) / 0.5)
}

/** Bright fills need dark type; dim warm tints keep the light shell type. */
export function heatInkIsDark(heat: number): boolean {
  return heatProgress(heat) >= 0.3
}

const HEAT_TEXT_0 = { r: 207, g: 207, b: 207 }

/** Gray → red → orange for heat % text on the dark shell. */
export function heatSwatch(heat: number): string {
  if (!(heat > 0)) return 'transparent'
  const t = heatProgress(heat)
  if (t <= 0.5) return mix(HEAT_TEXT_0, HEAT_STOP_MID, t / 0.5)
  return mix(HEAT_STOP_MID, HEAT_STOP_1, (t - 0.5) / 0.5)
}
