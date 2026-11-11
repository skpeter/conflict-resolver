import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeOAuthWorkerUrl } from '../src/lib/oauth/config.ts'
import {
  consumeOAuthHash,
  parseOAuthHash,
  parseStoredSession,
  refreshUrl,
  sessionFromTokenResponse,
  sessionFromTokens,
  sessionNeedsRefresh,
  signInUrl,
} from '../src/lib/oauth/session.ts'
import {
  buildAuthorizeUrl,
  callbackRedirectUri,
  corsHeadersFor,
  decodeOAuthState,
  encodeOAuthState,
  isAllowedReturnTo,
  parseAllowedOrigins,
  parseTokenPayload,
  spaErrorRedirectUrl,
  spaRedirectUrl,
  STATE_TTL_MS,
} from '../worker/src/oauth.ts'

const ORIGINS = parseAllowedOrigins(
  'https://skpeter.github.io,http://localhost:5173,http://127.0.0.1:5173',
)

describe('oauth worker url', () => {
  it('keeps the origin when a callback path is pasted', () => {
    assert.equal(
      normalizeOAuthWorkerUrl(
        'https://conflict-resolver-oauth.example.workers.dev/oauth/callback',
      ),
      'https://conflict-resolver-oauth.example.workers.dev',
    )
    assert.equal(
      normalizeOAuthWorkerUrl('http://127.0.0.1:8787/'),
      'http://127.0.0.1:8787',
    )
  })
})

describe('oauth return allowlist', () => {
  it('accepts the published app path on GitHub Pages', () => {
    assert.equal(
      isAllowedReturnTo('https://skpeter.github.io/conflict-resolver/', ORIGINS),
      true,
    )
  })

  it('accepts local Vite', () => {
    assert.equal(isAllowedReturnTo('http://localhost:5173/', ORIGINS), true)
    assert.equal(isAllowedReturnTo('http://127.0.0.1:5173/', ORIGINS), true)
  })

  it('rejects other origins, query, hash, and http on the public host', () => {
    assert.equal(isAllowedReturnTo('https://evil.example/', ORIGINS), false)
    assert.equal(
      isAllowedReturnTo('https://skpeter.github.io.evil.com/conflict-resolver/', ORIGINS),
      false,
    )
    assert.equal(
      isAllowedReturnTo('https://skpeter.github.io/conflict-resolver/?next=https://evil.example', ORIGINS),
      false,
    )
    assert.equal(
      isAllowedReturnTo('https://skpeter.github.io/conflict-resolver/#access_token=leak', ORIGINS),
      false,
    )
    assert.equal(isAllowedReturnTo('http://skpeter.github.io/conflict-resolver/', ORIGINS), false)
    assert.equal(isAllowedReturnTo('javascript:alert(1)', ORIGINS), false)
  })
})

describe('oauth state', () => {
  it('round-trips a signed return URL', async () => {
    const payload = {
      csrf: 'csrf-1',
      returnTo: 'https://skpeter.github.io/conflict-resolver/',
      iat: Date.now(),
    }
    const encoded = await encodeOAuthState(payload, 'secret')
    const decoded = await decodeOAuthState(encoded, 'secret')
    assert.deepEqual(decoded, payload)
  })

  it('rejects a tampered payload, wrong secret, and stale state', async () => {
    const encoded = await encodeOAuthState(
      {
        csrf: 'csrf-1',
        returnTo: 'https://skpeter.github.io/conflict-resolver/',
        iat: Date.now(),
      },
      'secret',
    )
    assert.equal(await decodeOAuthState(`${encoded}x`, 'secret'), null)
    assert.equal(await decodeOAuthState(encoded, 'other'), null)
    const stale = await encodeOAuthState(
      {
        csrf: 'csrf-1',
        returnTo: 'https://skpeter.github.io/conflict-resolver/',
        iat: Date.now() - STATE_TTL_MS - 1,
      },
      'secret',
    )
    assert.equal(await decodeOAuthState(stale, 'secret'), null)
  })
})

describe('authorize and spa redirect', () => {
  it('builds the start.gg authorize URL', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: 'https://oauth.example/oauth/callback',
        state: 'wrapped-state',
      }),
    )
    assert.equal(url.origin + url.pathname, 'https://start.gg/oauth/authorize')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('client_id'), 'client-1')
    assert.equal(url.searchParams.get('scope'), 'user.identity tournament.manager')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://oauth.example/oauth/callback')
    assert.equal(url.searchParams.get('state'), 'wrapped-state')
  })

  it('puts tokens only in the hash', () => {
    const dest = spaRedirectUrl(
      'https://skpeter.github.io/conflict-resolver/',
      { accessToken: 'tok', refreshToken: 'ref', expiresIn: 604800 },
      'csrf-1',
    )
    const url = new URL(dest)
    assert.equal(url.search, '')
    assert.equal(url.hash.includes('access_token=tok'), true)
    assert.equal(url.hash.includes('refresh_token=ref'), true)
    assert.equal(url.hash.includes('state=csrf-1'), true)
    assert.equal(callbackRedirectUri('https://oauth.example/oauth/start'), 'https://oauth.example/oauth/callback')
  })

  it('sends sign-in errors in the hash too', () => {
    const dest = spaErrorRedirectUrl(
      'https://skpeter.github.io/conflict-resolver/',
      'Sign-in was cancelled.',
      'csrf-1',
    )
    const url = new URL(dest)
    assert.equal(url.search, '')
    assert.equal(url.hash.includes('error='), true)
  })
})

describe('token payload', () => {
  it('reads top-level and nested start.gg token JSON', () => {
    assert.deepEqual(
      parseTokenPayload({
        access_token: 'a',
        refresh_token: 'b',
        expires_in: 60,
      }),
      { accessToken: 'a', refreshToken: 'b', expiresIn: 60 },
    )
    assert.deepEqual(
      parseTokenPayload({
        data: { access_token: 'a', refresh_token: 'b', expires_in: '60' },
      }),
      { accessToken: 'a', refreshToken: 'b', expiresIn: 60 },
    )
    assert.equal(parseTokenPayload({ access_token: 'a' }), null)
  })
})

describe('cors', () => {
  it('allows listed origins only', () => {
    assert.equal(corsHeadersFor('https://evil.example', ORIGINS), null)
    assert.equal(corsHeadersFor('https://skpeter.github.io', ORIGINS)?.['Access-Control-Allow-Origin'], 'https://skpeter.github.io')
    assert.equal(corsHeadersFor(null, ORIGINS), null)
  })
})

describe('spa hash and session', () => {
  it('parses tokens, errors, and empty hashes', () => {
    const tokens = parseOAuthHash(
      '#access_token=tok&refresh_token=ref&expires_in=604800&state=csrf-1',
    )
    assert.deepEqual(tokens, {
      kind: 'tokens',
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresIn: 604800,
      state: 'csrf-1',
    })
    const cancelled = parseOAuthHash('#error=access_denied&state=csrf-1')
    assert.deepEqual(cancelled, {
      kind: 'error',
      message: 'Sign-in was cancelled.',
      state: 'csrf-1',
    })
    assert.equal(parseOAuthHash('').kind, 'empty')
  })

  it('strips the hash after reading it', () => {
    const history = { replaced: '', replaceState(_s: unknown, _t: string, url: string) {
      this.replaced = url
    } }
    const parsed = consumeOAuthHash(
      {
        hash: '#access_token=tok&refresh_token=ref&expires_in=10&state=csrf-1',
        pathname: '/conflict-resolver/',
        search: '',
      },
      history,
    )
    assert.equal(parsed.kind, 'tokens')
    assert.equal(history.replaced, '/conflict-resolver/')
  })

  it('stores expiry and refreshes before it lapses', () => {
    const now = 1_000_000
    const session = sessionFromTokens('tok', 'ref', 600, now)
    assert.equal(session.expiresAt, now + 600_000)
    assert.equal(sessionNeedsRefresh(session, now, 5 * 60_000), false)
    assert.equal(sessionNeedsRefresh(session, now + 301_000, 5 * 60_000), true)
    assert.deepEqual(
      parseStoredSession(JSON.stringify(session)),
      session,
    )
    assert.equal(parseStoredSession('{"nope":true}'), null)
    assert.deepEqual(
      sessionFromTokenResponse(
        { access_token: 'a', refresh_token: 'b', expires_in: 10 },
        now,
      ),
      sessionFromTokens('a', 'b', 10, now),
    )
  })

  it('builds worker start and refresh URLs', () => {
    assert.equal(
      signInUrl('https://oauth.example', 'https://skpeter.github.io/conflict-resolver/', 'csrf-1'),
      'https://oauth.example/oauth/start?return=https%3A%2F%2Fskpeter.github.io%2Fconflict-resolver%2F&state=csrf-1',
    )
    assert.equal(refreshUrl('https://oauth.example'), 'https://oauth.example/oauth/refresh')
  })
})
