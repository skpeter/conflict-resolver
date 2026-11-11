import { useCallback, useEffect, useRef, useState } from 'react'
import { isOAuthConfigured, oauthWorkerUrl } from '@/lib/oauth/config'
import {
  consumeOAuthHash,
  CSRF_KEY,
  LEGACY_TOKEN_KEY,
  parseStoredSession,
  refreshUrl,
  SESSION_KEY,
  sessionFromTokenResponse,
  sessionFromTokens,
  sessionNeedsRefresh,
  signInUrl,
  type OAuthSession,
} from '@/lib/oauth/session'

function readCsrf(): string {
  if (typeof sessionStorage === 'undefined') return ''
  try {
    return sessionStorage.getItem(CSRF_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeCsrf(value: string | null) {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (value) sessionStorage.setItem(CSRF_KEY, value)
    else sessionStorage.removeItem(CSRF_KEY)
  } catch {
    // Private mode or quota.
  }
}

function clearLegacyToken() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    // ignore
  }
}

function readStoredSession(): OAuthSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return parseStoredSession(sessionStorage.getItem(SESSION_KEY))
  } catch {
    return null
  }
}

function writeStoredSession(session: OAuthSession | null) {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Private mode or quota — keep the in-memory value.
  }
}

function bootstrapAuth(): { session: OAuthSession | null; error: string | null } {
  if (typeof window === 'undefined') return { session: null, error: null }
  clearLegacyToken()
  const hashed = consumeOAuthHash(window.location, window.history)
  if (hashed.kind === 'error') {
    return { session: readStoredSession(), error: hashed.message }
  }
  if (hashed.kind === 'tokens') {
    const expected = readCsrf()
    if (!expected || hashed.state !== expected) {
      return {
        session: readStoredSession(),
        error: 'Sign-in could not be verified.',
      }
    }
    writeCsrf(null)
    const session = sessionFromTokens(
      hashed.accessToken,
      hashed.refreshToken,
      hashed.expiresIn,
      Date.now(),
    )
    writeStoredSession(session)
    return { session, error: null }
  }
  return { session: readStoredSession(), error: null }
}

export function useStartGgAuth() {
  const [boot] = useState(bootstrapAuth)
  const [session, setSession] = useState<OAuthSession | null>(boot.session)
  const [authError, setAuthError] = useState<string | null>(boot.error)
  const sessionRef = useRef(session)
  const refreshLock = useRef<Promise<string | null> | null>(null)
  const configured = isOAuthConfigured()

  useEffect(() => {
    sessionRef.current = session
    writeStoredSession(session)
  }, [session])

  const signOut = useCallback(() => {
    writeCsrf(null)
    writeStoredSession(null)
    sessionRef.current = null
    setSession(null)
  }, [])

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current
    if (!current) return null
    const worker = oauthWorkerUrl()
    if (!worker) {
      signOut()
      setAuthError('This build is missing OAuth configuration.')
      return null
    }
    try {
      const res = await fetch(refreshUrl(worker), {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      })
      const json: unknown = await res.json().catch(() => null)
      const next = sessionFromTokenResponse(json, Date.now())
      if (!res.ok || !next) {
        signOut()
        setAuthError('Session expired. Sign in with start.gg again.')
        return null
      }
      sessionRef.current = next
      setSession(next)
      return next.accessToken
    } catch {
      signOut()
      setAuthError('Session expired. Sign in with start.gg again.')
      return null
    }
  }, [signOut])

  const ensureToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current
    if (!current) return null
    if (!sessionNeedsRefresh(current, Date.now())) return current.accessToken
    if (!refreshLock.current) {
      refreshLock.current = refreshSession().finally(() => {
        refreshLock.current = null
      })
    }
    return refreshLock.current
  }, [refreshSession])

  const signIn = useCallback(() => {
    if (!configured) {
      setAuthError('This build is missing OAuth configuration.')
      return
    }
    const state = crypto.randomUUID()
    writeCsrf(state)
    const returnTo = `${window.location.origin}${import.meta.env.BASE_URL}`
    window.location.assign(signInUrl(oauthWorkerUrl(), returnTo, state))
  }, [configured])

  return {
    accessToken: session?.accessToken ?? '',
    authError,
    configured,
    signIn,
    signOut,
    ensureToken,
  }
}
