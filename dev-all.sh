#!/usr/bin/env bash
#
# dev-all.sh — launch all three Bluffline dev servers locally and stop them
# together on Ctrl+C. Encodes the WSL gotchas (Node 20 for Next, .env sourcing).
#
#   WS game server   → :8080
#   HTTP API         → :3001
#   Next frontend    → :3000 (or the next free port it prints)
#
# Usage:  bash dev-all.sh
# Then open the Next URL it prints in your Windows browser.

set -eo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE20=/home/believe/.linux-node20/bin/node
SECRET="${WS_SERVER_INTERNAL_SHARED_SECRET:-dev-secret}"

# Load 0G creds/secret if present (enables live chain/storage; harmless if absent).
if [ -f "$ROOT/backend/.env" ]; then set -a; . "$ROOT/backend/.env"; set +a; fi

pids=()
cleanup() {
  echo
  echo "stopping all servers..."
  [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "WS game server  → http://localhost:8080"
WS_SERVER_INTERNAL_SHARED_SECRET="$SECRET" PORT=8080 NODE_ENV=development \
  "$NODE20" "$ROOT/backend/ws-server/server.js" & pids+=($!)

echo "HTTP API        → http://localhost:3001"
WS_SERVER_INTERNAL_SHARED_SECRET="$SECRET" PORT=3001 NODE_ENV=development \
  "$NODE20" "$ROOT/backend/scripts/dev-api-server.js" & pids+=($!)

echo "Next frontend   → starting (watch for the URL below)..."
( cd "$ROOT/frontend" && PATH=/home/believe/.linux-node20/bin:$PATH NEXT_TELEMETRY_DISABLED=1 \
  exec "$NODE20" node_modules/next/dist/bin/next dev ) & pids+=($!)

echo
echo "Open the Next 'Local:' URL above in your Windows browser. Ctrl+C stops all three."
wait
