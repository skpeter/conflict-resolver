function trimSlash(value: string): string {
  return value.replace(/\/$/, '')
}

/** Worker origin only. A pasted `/oauth/callback` URL is reduced to the host. */
export function normalizeOAuthWorkerUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).origin
  } catch {
    return trimSlash(trimmed)
  }
}

export function oauthWorkerUrl(): string {
  const raw = import.meta.env.VITE_OAUTH_WORKER_URL
  return typeof raw === 'string' ? normalizeOAuthWorkerUrl(raw) : ''
}

export function startGgClientId(): string {
  const raw = import.meta.env.VITE_STARTGG_CLIENT_ID
  return typeof raw === 'string' ? raw.trim() : ''
}

export function isOAuthConfigured(): boolean {
  return Boolean(oauthWorkerUrl() && startGgClientId())
}
