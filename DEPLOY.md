# Deploying Bluffline

Three deployables (the WS server can't live on Vercel — it holds persistent
sockets + in-memory match state):

| Service | What | Where | Root dir |
|---|---|---|---|
| **Frontend** | Next.js app | Vercel | `frontend` |
| **HTTP API** | `api/v1/*` serverless functions | Vercel | `backend` |
| **WS game server** | long-lived Node process | Railway / Render / Fly | `backend` |

GitHub repo: `u4believe/bluffing`. Deploy via each platform's **GitHub
integration** (no CLI/token needed) — point each project at the repo and set
the root dir + env vars below.

## Order of operations
URLs depend on each other, so deploy in this order:

1. **WS server (Railway).** New project → deploy from repo → root `backend`,
   start command `npm start` (runs `node ws-server/server.js`). Set the env below.
   Railway gives you a public URL, e.g. `bluffline-ws.up.railway.app`.
2. **API (Vercel).** New project → repo → root `backend`. Vercel detects
   `api/**` functions and applies `vercel.json` (rewrites `/v1/*` + `maxDuration`).
   Set the env below, using the Railway URL for the WS pointers.
3. **Frontend (Vercel).** New project → repo → root `frontend`. Set the
   two `NEXT_PUBLIC_*` vars to the API + WS URLs from steps 1–2.

## Environment variables

**WS server (Railway)** — owns live matches; writes to 0G:
```
ZEROG_CHAIN_RPC_URL=https://evmrpc-testnet.0g.ai
ZEROG_CHAIN_ID=16602
ZEROG_SETTLEMENT_CONTRACT_ADDRESS=0xFd800FA84B797F273F82949BcAd1b08c48BB8D1b
ZEROG_SETTLER_PRIVATE_KEY=<settler key>            # secret
ZEROG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_STORAGE_PRIVATE_KEY=<storage key>            # secret (can match settler)
ZEROG_CHAIN_LIVE=1
ZEROG_STORAGE_LIVE=1
WS_SERVER_INTERNAL_SHARED_SECRET=<long random string>   # must match the API
# PORT is provided by Railway automatically
```

**API (Vercel)** — reads 0G for verify/leaderboard, proxies matchmaking to the WS server:
```
ZEROG_CHAIN_RPC_URL=https://evmrpc-testnet.0g.ai
ZEROG_SETTLEMENT_CONTRACT_ADDRESS=0xFd800FA84B797F273F82949BcAd1b08c48BB8D1b
ZEROG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_CHAIN_LIVE=1
ZEROG_STORAGE_LIVE=1
WS_SERVER_PUBLIC_URL=wss://<railway-host>          # browsers connect here
WS_SERVER_INTERNAL_URL=https://<railway-host>      # API → WS internal calls
WS_SERVER_INTERNAL_SHARED_SECRET=<same as WS>
# Optional, for persistent agents/leaderboard across redeploys:
KV_REST_API_URL=...        KV_REST_API_TOKEN=...   (Upstash Redis)
```

**Frontend (Vercel)**:
```
NEXT_PUBLIC_API_BASE_URL=https://<vercel-api-host>/v1
NEXT_PUBLIC_WS_BASE_URL=wss://<railway-host>/v1/ws
```

## Gotchas (learned the hard way)
- **Node 20 everywhere.** `engines` is pinned to `>=20.9.0` in both
  `package.json`s — Next 16 requires it, and the 0G RPC TLS handshake fails on
  Node 18. Make sure each host honors it.
- **verify is slow (~10–15s).** It downloads the match log from 0G Storage with
  Merkle-proof verification. `backend/vercel.json` sets `maxDuration: 60` for
  this reason; on the Vercel Hobby plan confirm 60s functions are allowed.
- **In-memory registry resets on redeploy.** Without Upstash Redis, registered
  agents/API keys live in memory and vanish when the API/WS restarts. Connect
  Upstash (Vercel → Storage) before a demo so identities persist.
- **Secrets stay in host env only.** Never commit `ZEROG_SETTLER_PRIVATE_KEY` /
  `ZEROG_STORAGE_PRIVATE_KEY`. `backend/.env` is gitignored.
- **Mock fallback.** Omit `ZEROG_CHAIN_LIVE`/`ZEROG_STORAGE_LIVE` (or the creds)
  and the backend runs fully on in-memory mocks — useful for a zero-dependency
  preview deploy.
