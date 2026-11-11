export const SESSION_KEY = 'conflict-resolver.startgg-oauth'
export const CSRF_KEY = 'conflict-resolver.oauth-state'
export const LEGACY_TOKEN_KEY = 'conflict-resolver.startgg-token'
export const REFRESH_SKEW_MS = 5 * 60_000

export type OAuthSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type ParsedOAuthHash =
  | {
      kind: 'tokens'
      accessToken: string
      refreshToken: string
      expiresIn: number
      state: string
    }
  | { kind: 'error'; message: string; state: string | null }
  | { kind: 'empty' }

export function parseOAuthHash(hash: string): ParsedOAuthHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { kind: 'empty' }
  const params = new URLSearchParams(raw)
  const state = params.get('state')
  const error = params.get('error')
  if (error) {
    return {
      kind: 'error',
      message: humanizeOAuthError(error),
      state,
    }
  }
  const accessToken = params.get('access_token') ?? ''
  const refreshToken = params.get('refresh_token') ?? ''
  const expiresIn = Number(params.get('expires_in'))
  if (!accessToken || !refreshToken || !state) return { kind: 'empty' }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { kind: 'error', message: 'start.gg sign-in was incomplete.', state }
  }
  return { kind: 'tokens', accessToken, refreshToken, expiresIn, state }
}

export function consumeOAuthHash(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): ParsedOAuthHash {
  const parsed = parseOAuthHash(location.hash)
  if (parsed.kind !== 'empty') {
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  }
  return parsed
}

export function sessionFromTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  now: number,
): OAuthSession {
  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
  }
}

export function sessionFromTokenResponse(
  json: unknown,
  now: number,
): OAuthSession | null {
  if (!json || typeof json !== 'object') return null
  const record = json as Record<string, unknown>
  const accessToken =
    typeof record.access_token === 'string' ? record.access_token : ''
  const refreshToken =
    typeof record.refresh_token === 'string' ? record.refresh_token : ''
  const expiresRaw = record.expires_in
  const expiresIn =
    typeof expiresRaw === 'number'
      ? expiresRaw
      : typeof expiresRaw === 'string'
        ? Number(expiresRaw)
        : NaN
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null
  }
  return sessionFromTokens(accessToken, refreshToken, expiresIn, now)
}

export function parseStoredSession(raw: string | null): OAuthSession | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const accessToken =
      typeof record.accessToken === 'string' ? record.accessToken : ''
    const refreshToken =
      typeof record.refreshToken === 'string' ? record.refreshToken : ''
    const expiresAt =
      typeof record.expiresAt === 'number' ? record.expiresAt : NaN
    if (!accessToken || !refreshToken || !Number.isFinite(expiresAt)) return null
    return { accessToken, refreshToken, expiresAt }
  } catch {
    return null
  }
}

export function sessionNeedsRefresh(
  session: OAuthSession,
  now: number,
  skewMs = REFRESH_SKEW_MS,
): boolean {
  return session.expiresAt - skewMs <= now
}

export function signInUrl(workerUrl: string, returnTo: string, state: string): string {
  const url = new URL('/oauth/start', `${workerUrl}/`)
  url.searchParams.set('return', returnTo)
  url.searchParams.set('state', state)
  return url.href
}

export function refreshUrl(workerUrl: string): string {
  return new URL('/oauth/refresh', `${workerUrl}/`).href
}

function humanizeOAuthError(error: string): string {
  if (error === 'access_denied' || error === 'Sign-in was cancelled.') {
    return 'Sign-in was cancelled.'
  }
  return error
}
