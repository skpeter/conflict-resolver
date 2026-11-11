import {
  buildAuthorizeUrl,
  callbackRedirectUri,
  corsHeadersFor,
  decodeOAuthState,
  encodeOAuthState,
  isAllowedReturnTo,
  parseAllowedOrigins,
  parseTokenPayload,
  REFRESH_URL,
  refreshExchangeBody,
  spaErrorRedirectUrl,
  spaRedirectUrl,
  TOKEN_URL,
  tokenExchangeBody,
} from './oauth.ts'

export type Env = {
  STARTGG_CLIENT_ID: string
  STARTGG_CLIENT_SECRET: string
  ALLOWED_ORIGINS: string
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')

    if (request.method === 'OPTIONS' && url.pathname === '/oauth/refresh') {
      return preflight(request, allowed)
    }
    if (url.pathname === '/oauth/start' && request.method === 'GET') {
      return start(request, url, env, allowed)
    }
    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      return callback(request, url, env, allowed)
    }
    if (url.pathname === '/oauth/refresh' && request.method === 'POST') {
      return refresh(request, env, allowed)
    }
    return new Response('Not found', { status: 404, headers: NO_STORE })
  },
}

function preflight(request: Request, allowed: string[]): Response {
  const cors = corsHeadersFor(request.headers.get('Origin'), allowed)
  if (!cors) return new Response('Forbidden', { status: 403, headers: NO_STORE })
  return new Response(null, { status: 204, headers: { ...NO_STORE, ...cors } })
}

async function start(
  request: Request,
  url: URL,
  env: Env,
  allowed: string[],
): Promise<Response> {
  const missing = missingConfig(env)
  if (missing) return new Response(missing, { status: 500, headers: NO_STORE })

  const returnTo = url.searchParams.get('return') ?? ''
  const csrf = url.searchParams.get('state') ?? ''
  if (!csrf || csrf.length > 128) {
    return new Response('Missing sign-in state.', { status: 400, headers: NO_STORE })
  }
  if (!isAllowedReturnTo(returnTo, allowed)) {
    return new Response('Return URL is not allowed.', {
      status: 400,
      headers: NO_STORE,
    })
  }

  const state = await encodeOAuthState(
    { csrf, returnTo, iat: Date.now() },
    env.STARTGG_CLIENT_SECRET,
  )
  const authorize = buildAuthorizeUrl({
    clientId: env.STARTGG_CLIENT_ID,
    redirectUri: callbackRedirectUri(request.url),
    state,
  })
  return Response.redirect(authorize, 302)
}

async function callback(
  request: Request,
  url: URL,
  env: Env,
  allowed: string[],
): Promise<Response> {
  const missing = missingConfig(env)
  if (missing) return new Response(missing, { status: 500, headers: NO_STORE })

  const encodedState = url.searchParams.get('state') ?? ''
  const payload = encodedState
    ? await decodeOAuthState(encodedState, env.STARTGG_CLIENT_SECRET)
    : null
  if (!payload || !isAllowedReturnTo(payload.returnTo, allowed)) {
    return new Response('Sign-in expired. Close this tab and try again.', {
      status: 400,
      headers: NO_STORE,
    })
  }

  const denied = url.searchParams.get('error')
  if (denied) {
    const message =
      denied === 'access_denied'
        ? 'Sign-in was cancelled.'
        : 'start.gg did not complete sign-in.'
    return Response.redirect(
      spaErrorRedirectUrl(payload.returnTo, message, payload.csrf),
      302,
    )
  }

  const code = url.searchParams.get('code') ?? ''
  if (!code) {
    return Response.redirect(
      spaErrorRedirectUrl(payload.returnTo, 'Missing authorization code.', payload.csrf),
      302,
    )
  }

  const redirectUri = callbackRedirectUri(request.url)
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        tokenExchangeBody({
          clientId: env.STARTGG_CLIENT_ID,
          clientSecret: env.STARTGG_CLIENT_SECRET,
          code,
          redirectUri,
        }),
      ),
    })
    const json: unknown = await res.json().catch(() => null)
    const tokens = parseTokenPayload(json)
    if (!res.ok || !tokens) {
      return Response.redirect(
        spaErrorRedirectUrl(
          payload.returnTo,
          'Could not complete start.gg sign-in.',
          payload.csrf,
        ),
        302,
      )
    }
    return Response.redirect(spaRedirectUrl(payload.returnTo, tokens, payload.csrf), 302)
  } catch {
    return Response.redirect(
      spaErrorRedirectUrl(
        payload.returnTo,
        'Could not complete start.gg sign-in.',
        payload.csrf,
      ),
      302,
    )
  }
}

async function refresh(
  request: Request,
  env: Env,
  allowed: string[],
): Promise<Response> {
  const cors = corsHeadersFor(request.headers.get('Origin'), allowed)
  if (!cors) return new Response('Forbidden', { status: 403, headers: NO_STORE })

  const missing = missingConfig(env)
  if (missing) {
    return json({ error: missing }, 500, cors)
  }

  let refreshToken = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'refresh_token' in body) {
      const value = (body as { refresh_token: unknown }).refresh_token
      if (typeof value === 'string') refreshToken = value
    }
  } catch {
    return json({ error: 'Expected JSON body.' }, 400, cors)
  }
  if (!refreshToken) {
    return json({ error: 'Missing refresh_token.' }, 400, cors)
  }

  try {
    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        refreshExchangeBody({
          clientId: env.STARTGG_CLIENT_ID,
          clientSecret: env.STARTGG_CLIENT_SECRET,
          refreshToken,
          redirectUri: callbackRedirectUri(request.url),
        }),
      ),
    })
    const jsonBody: unknown = await res.json().catch(() => null)
    const tokens = parseTokenPayload(jsonBody)
    if (!res.ok || !tokens) {
      return json({ error: 'Could not refresh start.gg session.' }, 401, cors)
    }
    return json(
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
      },
      200,
      cors,
    )
  } catch {
    return json({ error: 'Could not refresh start.gg session.' }, 502, cors)
  }
}

function missingConfig(env: Env): string | null {
  if (!env.STARTGG_CLIENT_ID?.trim() || !env.STARTGG_CLIENT_SECRET?.trim()) {
    return 'OAuth is not configured on this worker.'
  }
  return null
}

function json(
  body: Record<string, unknown>,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...NO_STORE,
      ...cors,
      'Content-Type': 'application/json',
    },
  })
}
