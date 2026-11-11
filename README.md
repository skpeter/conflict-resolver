# Conflict Resolver

One-page start.gg tool for elimination brackets. Sign in with start.gg, paste an event or bracket link, see rematch heat, open the last meeting, and push a small seed move while the phase is unplayed.

## Published page

Pushes to `main` build the page and publish it to GitHub Pages:

https://skpeter.github.io/conflict-resolver/

## Run locally

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

Local sign-in also needs the OAuth worker on port 8787 (see below).

## start.gg OAuth

The published UI does not take a pasted API token. Sign-in uses start.gg OAuth. GraphQL still goes from the browser to `https://api.start.gg/gql/alpha`. A Cloudflare Worker holds the client secret and does the code exchange and refresh.

### 1. Create the start.gg OAuth app

In the [start.gg developer portal](https://developer.start.gg/), create an OAuth application.

Scopes the Worker requests: `user.identity` and `tournament.manager`.

Register the production redirect URI exactly:

- `https://<worker-subdomain>.workers.dev/oauth/callback`

start.gg apps are often production-callback only. In that case local Vite should still call the **deployed** Worker; you do not need a `127.0.0.1:8787` redirect URI. Only register a local callback if you also run `wrangler dev` and start.gg lets you add it.

Copy the client id and client secret.

### 2. Deploy the Worker

From the repo root, after logging in with `npx wrangler@4 login`:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Put the client id and secret in `worker/.dev.vars` for local runs (gitignored).

```bash
npx wrangler@4 dev --config worker/wrangler.toml
```

```bash
npx wrangler@4 deploy --config worker/wrangler.toml
npx wrangler@4 secret put STARTGG_CLIENT_ID --config worker/wrangler.toml
npx wrangler@4 secret put STARTGG_CLIENT_SECRET --config worker/wrangler.toml
```

`ALLOWED_ORIGINS` is already set in `worker/wrangler.toml` for GitHub Pages and local Vite.

### 3. Point the static app at the Worker

Local env (Vite priority: `.env.development.local` > `.env.development` > `.env.local`):

- Set `VITE_STARTGG_CLIENT_ID` and `VITE_OAUTH_WORKER_URL` in `.env.development.local` when using the deployed Worker from `npm run dev` (usual with a production-only start.gg callback).
- `VITE_OAUTH_WORKER_URL` must be the Worker **origin only**, e.g. `https://<worker-subdomain>.workers.dev` — not `/oauth/callback`, and not a trailing slash.
- `.env.development` still defaults to `http://127.0.0.1:8787` for a local `wrangler dev` Worker. That file wins over `.env.local`, which is why a Workers URL only in `.env.local` still sent the browser to 8787.

Production GitHub Actions repository variables (Settings → Secrets and variables → Actions → Variables):

- `VITE_STARTGG_CLIENT_ID` — public OAuth client id
- `VITE_OAUTH_WORKER_URL` — `https://<worker-subdomain>.workers.dev` with no trailing slash

The Pages workflow injects those into the production build. They are public by design; the client secret stays in Worker secrets.

## Notes

- Access and refresh tokens stay in tab memory (`sessionStorage`) and are sent only to `https://api.start.gg/gql/alpha` (access token) and the OAuth Worker (refresh).
- Only the two Advanced multipliers are stored in `localStorage`.
- Singles single-elim and double-elim only. No bracket reset.
