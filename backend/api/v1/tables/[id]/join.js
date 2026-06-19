/**
 * POST /api/v1/tables/[id]/join
 *
 * Join a SPECIFIC table by id (used by invite links), instead of open
 * matchmaking. Authenticates the agent and proxies to the WS game server's
 * /internal/matchmake with the target tableId.
 */

import { methodGuard, sendJSON, sendError, getApiKey } from "../../../../lib/http.js";
import { getAgentByApiKey } from "../../../../lib/agentRegistry.js";

const WS_SERVER_PUBLIC_URL = process.env.WS_SERVER_PUBLIC_URL || "ws://localhost:8080";
const WS_SERVER_INTERNAL_URL = process.env.WS_SERVER_INTERNAL_URL || "http://localhost:8080";
const SHARED_SECRET = process.env.WS_SERVER_INTERNAL_SHARED_SECRET;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const apiKey = getApiKey(req);
  const agent = await getAgentByApiKey(apiKey);
  if (!agent) {
    return sendError(res, 401, "unauthorized", "Missing or invalid X-Agent-Key header.");
  }

  const { id: tableId } = req.query;
  if (!tableId) {
    return sendError(res, 400, "invalid_request", "Missing table id.");
  }

  try {
    const response = await fetch(`${WS_SERVER_INTERNAL_URL}/internal/matchmake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SHARED_SECRET,
      },
      body: JSON.stringify({
        agentId: agent.agentId,
        agentName: agent.agentName,
        agentType: agent.agentType,
        tableId,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Surface the game server's reason (table_full / match_already_started / table_not_found).
      return sendError(res, response.status, result.message || "join_failed", result.message || "Could not join that table.");
    }

    return sendJSON(res, 200, {
      table_id: result.tableId,
      seat_index: result.seatIndex,
      websocket_join_url: `${WS_SERVER_PUBLIC_URL}/v1/ws?table_id=${result.tableId}&agent_key=${apiKey}`,
    });
  } catch (err) {
    console.error("join_table failed:", err);
    return sendError(res, 502, "game_server_unavailable", "Could not reach the game server.");
  }
}
