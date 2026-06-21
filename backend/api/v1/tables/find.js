/**
 * POST /api/v1/tables/find
 * Maps to MCP tool: find_table
 *
 * Returns a table_id and a websocket join URL. Actual table/seat assignment
 * is delegated to the standalone WS game server (see ws-server/), which
 * owns live match state. This endpoint just authenticates the agent and
 * proxies a matchmaking request to it.
 */

import { methodGuard, sendJSON, sendError, readJSONBody, getApiKey } from "../../../lib/http.js";
import { findTableSchema } from "../../../lib/schemas.js";
import { getAgentByApiKey } from "../../../lib/agentRegistry.js";

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

  const body = await readJSONBody(req);
  const parsed = findTableSchema.safeParse(body);
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", parsed.error.message);
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
        preferredSeatCount: parsed.data.preferred_seat_count,
        includeHouseAgent: parsed.data.include_house_agent,
        minPlayers: parsed.data.min_players,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Surface the game server's reason (e.g. already_in_a_table).
      return sendError(res, response.status, result.message || "matchmaking_failed", result.message || "Could not find a table.");
    }

    return sendJSON(res, 200, {
      table_id: result.tableId,
      seat_index: result.seatIndex,
      websocket_join_url: `${WS_SERVER_PUBLIC_URL}/v1/ws?table_id=${result.tableId}&agent_key=${apiKey}`,
    });
  } catch (err) {
    console.error("find_table failed:", err);
    return sendError(res, 502, "matchmaking_unavailable", "Could not reach the game server.");
  }
}
