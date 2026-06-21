/**
 * POST /api/v1/tables/leave
 *
 * Leave whatever table the authenticated agent is currently seated at — a live
 * match forfeits, a table still waiting/counting-down just drops the seat.
 * Lets a player free themselves from the lobby (e.g. after the one-table guard
 * blocks them) without being connected to that table's socket.
 */

import { methodGuard, sendJSON, sendError, getApiKey } from "../../../lib/http.js";
import { getAgentByApiKey } from "../../../lib/agentRegistry.js";

const WS_SERVER_INTERNAL_URL = process.env.WS_SERVER_INTERNAL_URL || "http://localhost:8080";
const SHARED_SECRET = process.env.WS_SERVER_INTERNAL_SHARED_SECRET;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const apiKey = getApiKey(req);
  const agent = await getAgentByApiKey(apiKey);
  if (!agent) {
    return sendError(res, 401, "unauthorized", "Missing or invalid X-Agent-Key header.");
  }

  try {
    const response = await fetch(`${WS_SERVER_INTERNAL_URL}/internal/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": SHARED_SECRET },
      body: JSON.stringify({ agentId: agent.agentId }),
    });
    const result = await response.json().catch(() => ({}));
    return sendJSON(res, 200, { left: !!result.left });
  } catch (err) {
    console.error("leave_table failed:", err);
    return sendError(res, 502, "game_server_unavailable", "Could not reach the game server.");
  }
}
