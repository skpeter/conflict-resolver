export const SCOPES = 'user.identity tournament.manager'
export const AUTHORIZE_URL = 'https://start.gg/oauth/authorize'
export const TOKEN_URL = 'https://api.start.gg/oauth/access_token'
export const REFRESH_URL = 'https://api.start.gg/oauth/refresh'
export const STATE_TTL_MS = 10 * 60_000

export type TokenSet = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export type OAuthStatePayload = {
  csrf: string
  returnTo: string
  iat: number
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

export function isAllowedReturnTo(
  returnTo: string,
  allowedOrigins: string[],
): boolean {
  let url: URL
  try {
    url = new URL(returnTo)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash || url.search) return false
  if (url.pathname.includes('//') || url.pathname.includes('\\')) return false
  const httpsOk = url.protocol === 'https:'
  const localOk = url.protocol === 'http:' && isLoopbackHost(url.hostname)
  if (!httpsOk && !localOk) return false
  return allowedOrigins.includes(url.origin)
}

export function callbackRedirectUri(requestUrl: string): string {
  return new URL('/oauth/callback', requestUrl).href
}

export function buildAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.state)
  return url.href
}

export function tokenExchangeBody(opts: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Record<string, string> {
  return {
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    scope: SCOPES,
    redirect_uri: opts.redirectUri,
  }
}

export function refreshExchangeBody(opts: {
  clientId: string
  clientSecret: string
  refreshToken: string
  redirectUri: string
}): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    scope: SCOPES,
    redirect_uri: opts.redirectUri,
  }
}

export function parseTokenPayload(json: unknown): TokenSet | null {
  const root =
    json && typeof json === 'object' && 'data' in json && json.data
      ? json.data
      : json
  if (!root || typeof root !== 'object') return null
  const record = root as Record<string, unknown>
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
  return { accessToken, refreshToken, expiresIn }
}

export function spaRedirectUrl(
  returnTo: string,
  tokens: TokenSet,
  csrf: string,
): string {
  const hash = new URLSearchParams({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: String(tokens.expiresIn),
    state: csrf,
  })
  return `${returnTo}#${hash.toString()}`
}

export function spaErrorRedirectUrl(
  returnTo: string,
  message: string,
  csrf?: string,
): string {
  const hash = new URLSearchParams({ error: message })
  if (csrf) hash.set('state', csrf)
  return `${returnTo}#${hash.toString()}`
}

export function corsHeadersFor(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> | null {
  if (!origin || !allowedOrigins.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export async function encodeOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSha256(secret, body)
  return `${body}.${sig}`
}

export async function decodeOAuthState(
  state: string,
  secret: string,
  now = Date.now(),
): Promise<OAuthStatePayload | null> {
  const sep = state.indexOf('.')
  if (sep <= 0 || sep === state.length - 1) return null
  const body = state.slice(0, sep)
  const sig = state.slice(sep + 1)
  const expected = await hmacSha256(secret, body)
  if (!timingSafeEqual(sig, expected)) return null
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const csrf = typeof record.csrf === 'string' ? record.csrf : ''
  const returnTo = typeof record.returnTo === 'string' ? record.returnTo : ''
  const iat = typeof record.iat === 'number' ? record.iat : NaN
  if (!csrf || !returnTo || !Number.isFinite(iat)) return null
  if (now - iat > STATE_TTL_MS || iat > now + 60_000) return null
  return { csrf, returnTo, iat }
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  return bytesToBase64Url(new Uint8Array(sig))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const bin = atob(padded + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}
