/**
 * Local calendar date of clockMs in the given IANA timezone.
 * Tests pass a fixed timezone.
 */
export function localCalendarDate(
  clockMs: number,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(clockMs))
}

export function exactDayCount(days: number): string {
  if (Number.isInteger(days)) return String(days)
  // Keep enough precision that the formula can be checked, trim trailing zeros.
  return days.toFixed(6).replace(/\.?0+$/, '')
}

/**
 * Last path segment, or the segment after `tournament` / `event` when the
 * API already returned a prefixed slug.
 */
export function startGgPathSegment(
  value: string,
  marker: 'tournament' | 'event',
): string {
  const parts = value.split('/').filter(Boolean)
  const idx = parts.lastIndexOf(marker)
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]
  return parts[parts.length - 1] ?? ''
}

export function receiptEventUrl(
  tournamentSlug: string,
  eventSlug: string,
): string {
  const tournament = startGgPathSegment(tournamentSlug, 'tournament')
  const event = startGgPathSegment(eventSlug, 'event')
  return `https://www.start.gg/tournament/${tournament}/event/${event}`
}

export function receiptSetUrl(
  tournamentSlug: string,
  eventSlug: string,
  setId: string,
): string {
  return `${receiptEventUrl(tournamentSlug, eventSlug)}/set/${setId}`
}

export function receiptHeading(tournamentName: string, eventName: string): string {
  const tournament = tournamentName.trim()
  const event = eventName.trim()
  if (tournament && event) return `${tournament} · ${event}`
  return tournament || event
}
