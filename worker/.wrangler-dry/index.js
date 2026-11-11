var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/oauth.ts
var SCOPES = "user.identity tournament.manager";
var AUTHORIZE_URL = "https://start.gg/oauth/authorize";
var TOKEN_URL = "https://api.start.gg/oauth/access_token";
var REFRESH_URL = "https://api.start.gg/oauth/refresh";
var STATE_TTL_MS = 10 * 6e4;
function parseAllowedOrigins(raw) {
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}
__name(parseAllowedOrigins, "parseAllowedOrigins");
function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
__name(isLoopbackHost, "isLoopbackHost");
function isAllowedReturnTo(returnTo, allowedOrigins) {
  let url;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || url.search) return false;
  if (url.pathname.includes("//") || url.pathname.includes("\\")) return false;
  const httpsOk = url.protocol === "https:";
  const localOk = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!httpsOk && !localOk) return false;
  return allowedOrigins.includes(url.origin);
}
__name(isAllowedReturnTo, "isAllowedReturnTo");
function callbackRedirectUri(requestUrl) {
  return new URL("/oauth/callback", requestUrl).href;
}
__name(callbackRedirectUri, "callbackRedirectUri");
function buildAuthorizeUrl(opts) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.href;
}
__name(buildAuthorizeUrl, "buildAuthorizeUrl");
function tokenExchangeBody(opts) {
  return {
    grant_type: "authorization_code",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    scope: SCOPES,
    redirect_uri: opts.redirectUri
  };
}
__name(tokenExchangeBody, "tokenExchangeBody");
function refreshExchangeBody(opts) {
  return {
    grant_type: "refresh_token",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    scope: SCOPES,
    redirect_uri: opts.redirectUri
  };
}
__name(refreshExchangeBody, "refreshExchangeBody");
function parseTokenPayload(json2) {
  const root = json2 && typeof json2 === "object" && "data" in json2 && json2.data ? json2.data : json2;
  if (!root || typeof root !== "object") return null;
  const record = root;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token : "";
  const expiresRaw = record.expires_in;
  const expiresIn = typeof expiresRaw === "number" ? expiresRaw : typeof expiresRaw === "string" ? Number(expiresRaw) : NaN;
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  return { accessToken, refreshToken, expiresIn };
}
__name(parseTokenPayload, "parseTokenPayload");
function spaRedirectUrl(returnTo, tokens, csrf) {
  const hash = new URLSearchParams({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: String(tokens.expiresIn),
    state: csrf
  });
  return `${returnTo}#${hash.toString()}`;
}
__name(spaRedirectUrl, "spaRedirectUrl");
function spaErrorRedirectUrl(returnTo, message, csrf) {
  const hash = new URLSearchParams({ error: message });
  if (csrf) hash.set("state", csrf);
  return `${returnTo}#${hash.toString()}`;
}
__name(spaErrorRedirectUrl, "spaErrorRedirectUrl");
function corsHeadersFor(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(corsHeadersFor, "corsHeadersFor");
async function encodeOAuthState(payload, secret) {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, body);
  return `${body}.${sig}`;
}
__name(encodeOAuthState, "encodeOAuthState");
async function decodeOAuthState(state, secret, now = Date.now()) {
  const sep = state.indexOf(".");
  if (sep <= 0 || sep === state.length - 1) return null;
  const body = state.slice(0, sep);
  const sig = state.slice(sep + 1);
  const expected = await hmacSha256(secret, body);
  if (!timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload;
  const csrf = typeof record.csrf === "string" ? record.csrf : "";
  const returnTo = typeof record.returnTo === "string" ? record.returnTo : "";
  const iat = typeof record.iat === "number" ? record.iat : NaN;
  if (!csrf || !returnTo || !Number.isFinite(iat)) return null;
  if (now - iat > STATE_TTL_MS || iat > now + 6e4) return null;
  return { csrf, returnTo, iat };
}
__name(decodeOAuthState, "decodeOAuthState");
async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return bytesToBase64Url(new Uint8Array(sig));
}
__name(hmacSha256, "hmacSha256");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function bytesToBase64Url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - padded.length % 4);
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
__name(base64UrlToBytes, "base64UrlToBytes");

// src/index.ts
var NO_STORE = { "Cache-Control": "no-store" };
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? "");
    if (request.method === "OPTIONS" && url.pathname === "/oauth/refresh") {
      return preflight(request, allowed);
    }
    if (url.pathname === "/oauth/start" && request.method === "GET") {
      return start(request, url, env, allowed);
    }
    if (url.pathname === "/oauth/callback" && request.method === "GET") {
      return callback(request, url, env, allowed);
    }
    if (url.pathname === "/oauth/refresh" && request.method === "POST") {
      return refresh(request, env, allowed);
    }
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }
};
function preflight(request, allowed) {
  const cors = corsHeadersFor(request.headers.get("Origin"), allowed);
  if (!cors) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  return new Response(null, { status: 204, headers: { ...NO_STORE, ...cors } });
}
__name(preflight, "preflight");
async function start(request, url, env, allowed) {
  const missing = missingConfig(env);
  if (missing) return new Response(missing, { status: 500, headers: NO_STORE });
  const returnTo = url.searchParams.get("return") ?? "";
  const csrf = url.searchParams.get("state") ?? "";
  if (!csrf || csrf.length > 128) {
    return new Response("Missing sign-in state.", { status: 400, headers: NO_STORE });
  }
  if (!isAllowedReturnTo(returnTo, allowed)) {
    return new Response("Return URL is not allowed.", {
      status: 400,
      headers: NO_STORE
    });
  }
  const state = await encodeOAuthState(
    { csrf, returnTo, iat: Date.now() },
    env.STARTGG_CLIENT_SECRET
  );
  const authorize = buildAuthorizeUrl({
    clientId: env.STARTGG_CLIENT_ID,
    redirectUri: callbackRedirectUri(request.url),
    state
  });
  return Response.redirect(authorize, 302);
}
__name(start, "start");
async function callback(request, url, env, allowed) {
  const missing = missingConfig(env);
  if (missing) return new Response(missing, { status: 500, headers: NO_STORE });
  const encodedState = url.searchParams.get("state") ?? "";
  const payload = encodedState ? await decodeOAuthState(encodedState, env.STARTGG_CLIENT_SECRET) : null;
  if (!payload || !isAllowedReturnTo(payload.returnTo, allowed)) {
    return new Response("Sign-in expired. Close this tab and try again.", {
      status: 400,
      headers: NO_STORE
    });
  }
  const denied = url.searchParams.get("error");
  if (denied) {
    const message = denied === "access_denied" ? "Sign-in was cancelled." : "start.gg did not complete sign-in.";
    return Response.redirect(
      spaErrorRedirectUrl(payload.returnTo, message, payload.csrf),
      302
    );
  }
  const code = url.searchParams.get("code") ?? "";
  if (!code) {
    return Response.redirect(
      spaErrorRedirectUrl(payload.returnTo, "Missing authorization code.", payload.csrf),
      302
    );
  }
  const redirectUri = callbackRedirectUri(request.url);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        tokenExchangeBody({
          clientId: env.STARTGG_CLIENT_ID,
          clientSecret: env.STARTGG_CLIENT_SECRET,
          code,
          redirectUri
        })
      )
    });
    const json2 = await res.json().catch(() => null);
    const tokens = parseTokenPayload(json2);
    if (!res.ok || !tokens) {
      return Response.redirect(
        spaErrorRedirectUrl(
          payload.returnTo,
          "Could not complete start.gg sign-in.",
          payload.csrf
        ),
        302
      );
    }
    return Response.redirect(spaRedirectUrl(payload.returnTo, tokens, payload.csrf), 302);
  } catch {
    return Response.redirect(
      spaErrorRedirectUrl(
        payload.returnTo,
        "Could not complete start.gg sign-in.",
        payload.csrf
      ),
      302
    );
  }
}
__name(callback, "callback");
async function refresh(request, env, allowed) {
  const cors = corsHeadersFor(request.headers.get("Origin"), allowed);
  if (!cors) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const missing = missingConfig(env);
  if (missing) {
    return json({ error: missing }, 500, cors);
  }
  let refreshToken = "";
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "refresh_token" in body) {
      const value = body.refresh_token;
      if (typeof value === "string") refreshToken = value;
    }
  } catch {
    return json({ error: "Expected JSON body." }, 400, cors);
  }
  if (!refreshToken) {
    return json({ error: "Missing refresh_token." }, 400, cors);
  }
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        refreshExchangeBody({
          clientId: env.STARTGG_CLIENT_ID,
          clientSecret: env.STARTGG_CLIENT_SECRET,
          refreshToken,
          redirectUri: callbackRedirectUri(request.url)
        })
      )
    });
    const jsonBody = await res.json().catch(() => null);
    const tokens = parseTokenPayload(jsonBody);
    if (!res.ok || !tokens) {
      return json({ error: "Could not refresh start.gg session." }, 401, cors);
    }
    return json(
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn
      },
      200,
      cors
    );
  } catch {
    return json({ error: "Could not refresh start.gg session." }, 502, cors);
  }
}
__name(refresh, "refresh");
function missingConfig(env) {
  if (!env.STARTGG_CLIENT_ID?.trim() || !env.STARTGG_CLIENT_SECRET?.trim()) {
    return "OAuth is not configured on this worker.";
  }
  return null;
}
__name(missingConfig, "missingConfig");
function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...NO_STORE,
      ...cors,
      "Content-Type": "application/json"
    }
  });
}
__name(json, "json");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
