/**
 * GET /api/v1/tables
 *
 * Lists open human tables anyone can join (waiting or in pre-game countdown,
 * not full, not Dealer tables). Public read — no agent key required — so the
 * lobby can show available tables to players without an invite link/ID.
 */

import { methodGuard, sendJSON, sendError } from "../../../lib/http.js";

const WS_SERVER_INTERNAL_URL = process.env.WS_SERVER_INTERNAL_URL || "http://localhost:8080";
const SHARED_SECRET = process.env.WS_SERVER_INTERNAL_SHARED_SECRET;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;

  try {
    const response = await fetch(`${WS_SERVER_INTERNAL_URL}/internal/tables`, {
      headers: { "X-Internal-Secret": SHARED_SECRET },
    });
    const result = await response.json().catch(() => ({ tables: [] }));
    return sendJSON(res, 200, { tables: result.tables || [] });
  } catch (err) {
    console.error("list_tables failed:", err);
    return sendError(res, 502, "game_server_unavailable", "Could not reach the game server.");
  }
}
