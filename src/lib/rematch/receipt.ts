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

export function receiptEventUrl(
  tournamentSlug: string,
  eventSlug: string,
): string {
  return `https://www.start.gg/tournament/${tournamentSlug}/event/${eventSlug}`
}
