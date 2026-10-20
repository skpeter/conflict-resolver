export type ResolvedLink =
  | { kind: 'bracket'; phaseId: string }
  | { kind: 'event'; tournamentSlug: string; eventSlug: string }
  | { kind: 'invalid'; reason: string }

export function resolveStartGgLink(raw: string): ResolvedLink {
  let url: URL
  try {
    const trimmed = raw.trim()
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    url = new URL(withScheme)
  } catch {
    return { kind: 'invalid', reason: 'Not a start.gg link' }
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'start.gg') {
    return { kind: 'invalid', reason: 'Host must be start.gg' }
  }

  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  // /tournament/{t}/event/{e}/...
  const tIdx = parts.indexOf('tournament')
  const eIdx = parts.indexOf('event')
  if (tIdx < 0 || eIdx < 0 || eIdx !== tIdx + 2) {
    return { kind: 'invalid', reason: 'Need a tournament event or bracket link' }
  }
  const tournamentSlug = parts[tIdx + 1]
  const eventSlug = parts[eIdx + 1]
  if (!tournamentSlug || !eventSlug) {
    return { kind: 'invalid', reason: 'Need a tournament event or bracket link' }
  }

  const bracketsIdx = parts.indexOf('brackets')
  if (bracketsIdx >= 0 && parts[bracketsIdx + 1]) {
    return { kind: 'bracket', phaseId: parts[bracketsIdx + 1] }
  }

  return { kind: 'event', tournamentSlug, eventSlug }
}

export const ELIM_BRACKET_TYPES = new Set([
  'SINGLE_ELIMINATION',
  'DOUBLE_ELIMINATION',
])
