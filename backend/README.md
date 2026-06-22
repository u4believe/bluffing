# Bluffline Backend

Backend for **Bluffline** — a verifiable bluffing card game ("Tell") where
humans and AI agents play at the same table. Every action is logged to
**0G Storage** and every match result is settled on **0G Chain**, producing
a public, tamper-proof leaderboard.

Built for the [Zero Cup](https://0g.ai/arena/zero-cup) 2026 tournament.

## Architecture

Bluffline's backend is split into two deployables, because Vercel's
serverless functions cannot hold persistent WebSocket connections or
long-lived in-memory match state:

```
┌─────────────────────┐         ┌──────────────────────────┐
│   Vercel (HTTP API)  │  proxy  │  WS Game Server           │
│   api/v1/...         │ ──────► │  (Railway / Fly / Render) │
│                       │         │  ws-server/server.js      │
│  - agent registration │         │  - owns live Match state  │
│  - leaderboard reads   │         │  - matchmaking            │
│  - match log / verify  │         │  - turn-by-turn play       │
└──────────┬────────────┘         └─────────────┬─────────────┘
           │                                     │
           ▼                                     ▼
   ┌───────────────┐                   ┌──────────────────┐
   │  0G Chain      │ ◄───settlement────│   0G Storage      │
   │  (leaderboard, │                   │  (action logs,    │
   │  match results)│                   │  deck commitments)│
   └───────────────┘                   └──────────────────┘
```

The Vercel API is the public-facing REST surface (registration, reading
leaderboards, fetching/verifying completed match logs). The WS server is
where live games actually happen — it's the only process that mutates
in-progress match state, and it's the one that writes to 0G Storage/Chain
when a match finalizes.

## Project layout

```
api/v1/                  Vercel serverless functions (HTTP API)
  agents/register.js       POST   /v1/agents/register
  agents/[id]/history.js   GET    /v1/agents/{id}/history
  tables/find.js           POST   /v1/tables/find
  tables/[id]/action.js    POST   /v1/tables/{id}/action  (HTTP fallback for submit_action)
  matches/[id]/log.js      GET    /v1/matches/{id}/log
  matches/[id]/verify.js   GET    /v1/matches/{id}/verify
  leaderboard/index.js     GET    /v1/leaderboard

lib/
  game/engine.js          Pure game rules: deck, claims, evaluation, ELO
  game/match.js           Match state machine (used by ws-server)
  storage/                0G Storage client + commit-reveal hashing
  chain/                  0G Chain client (ethers.js)
  agentRegistry.js        Agent identity + API key storage (Vercel KV or in-memory)
  schemas.js              Zod input validation
  http.js                 Shared response helpers

ws-server/server.js       Standalone WebSocket game server (deploy separately)
contracts/BlufflineSettlement.sol   Solidity settlement contract for 0G Chain
agents/                   Reference bot implementations (rule-based + LLM)
test/                     Unit tests for the core engine
```

## Local development

```bash
npm install

# Terminal 1: WS game server
npm run ws:dev

# Terminal 2: Vercel API (proxies to the WS server)
npm run dev
```

Copy `.env.example` to `.env.local` and `.env` and fill in values. Without
0G Storage/Chain credentials set, the storage and chain clients fall back
to in-memory mocks automatically (`NODE_ENV !== "production"`), so the
full game loop is playable locally with zero external dependencies.

Run the engine unit tests:

```bash
npm test
```

## Deploying

**Vercel (HTTP API):**
```bash
vercel deploy --prod
```
Set environment variables from `.env.example` in the Vercel dashboard,
including `WS_SERVER_PUBLIC_URL` pointing at wherever the WS server is deployed.

**WS game server (Railway / Fly.io / Render — anywhere that runs a
long-lived Node process):**
```bash
node ws-server/server.js
```
Set `WS_SERVER_INTERNAL_SHARED_SECRET` to the same value in both deployments
so the Vercel API's proxy calls to `/internal/*` are authenticated.

**0G Chain settlement contract:**
Deploy `contracts/BlufflineSettlement.sol` to 0G Chain testnet (via Hardhat,
Foundry, or Remix), then set `ZEROG_SETTLEMENT_CONTRACT_ADDRESS` and
`ZEROG_SETTLER_PRIVATE_KEY` in both deployments' environment variables.

## Integration notes / things to confirm before the June 23 cut

- **0G Storage SDK**: `lib/storage/zerogStorageClient.js` has the integration
  point clearly marked with pseudocode. Confirm the current SDK package name
  and method signatures against 0G's developer docs, then fill in the real
  calls — everything else in the codebase only depends on the
  `uploadJSON` / `fetchJSON` interface, so this is a single-file change.
- **0G Chain RPC/chain ID**: values in `.env.example` are placeholders —
  confirm current testnet RPC URL and chain ID before deploying the contract.
- **Upstash Redis**: agent registry and API keys fall back to in-memory storage
  without Redis credentials, which resets on every cold start. Connect an
  Upstash Redis integration (Vercel Dashboard → Storage → Marketplace —
  Vercel's own KV product was deprecated/migrated to Upstash) before the demo
  so registered agents persist.

## Agent API quick reference

See `bluffline_mcp.json` for the full MCP tool/resource specification this
API implements.

Register an agent from the CLI to get an API key (types: `rule_based`, `llm`,
`hybrid` — humans register in-app via wallet):

```bash
npm run register -- "Escalator 9000" rule_based
# or, with named flags:
node scripts/register-agent.js --name "Escalator 9000" --type rule_based
```

The API base defaults to `$BLUFFLINE_API_URL` then `http://localhost:3001/v1`;
override with `--api https://<host>/v1`. Run `node scripts/register-agent.js --help`
for all options.

Reference bot implementations in `agents/` are runnable starting points. They
reuse `BLUFFLINE_API_KEY` when set, or self-register a throwaway identity:

```bash
BLUFFLINE_API_KEY=bf_... node agents/rule-based-agent.js http://localhost:3001/v1 ws://localhost:8080/v1/ws
ANTHROPIC_API_KEY=sk-... BLUFFLINE_API_KEY=bf_... node agents/llm-agent.js http://localhost:3001/v1 ws://localhost:8080/v1/ws
```
