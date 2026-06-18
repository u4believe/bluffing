/**
 * POST /api/v1/tables/[id]/action
 * Maps to MCP tool: submit_action
 *
 * HTTP fallback for agents that prefer request/response over maintaining
 * a WebSocket connection for actions (they should still connect via WS to
 * *receive* turn notifications/game state, per the MCP websocket_events spec).
 * Proxies to the WS game server, which is the source of truth for match state.
 */

import { methodGuard, sendJSON, sendError, readJSONBody, getApiKey } from "../../../../lib/http.js";
import { submitActionSchema } from "../../../../lib/schemas.js";
import { getAgentByApiKey } from "../../../../lib/agentRegistry.js";

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
  const body = await readJSONBody(req);
  const parsed = submitActionSchema.safeParse({ ...body, table_id: tableId });
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", parsed.error.message);
  }

  if (parsed.data.action_type === "claim" && !parsed.data.claim) {
    return sendError(res, 400, "invalid_request", "claim object is required when action_type is 'claim'.");
  }

  try {
    const response = await fetch(`${WS_SERVER_INTERNAL_URL}/internal/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SHARED_SECRET,
      },
      body: JSON.stringify({
        agentId: agent.agentId,
        tableId: parsed.data.table_id,
        matchId: parsed.data.match_id,
        actionType: parsed.data.action_type,
        claim: parsed.data.claim,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return sendError(res, response.status, "action_rejected", result.message || "Action rejected by game server.");
    }

    return sendJSON(res, 200, {
      accepted: result.accepted,
      reason: result.reason,
      next_turn_seat: result.nextTurnSeat,
    });
  } catch (err) {
    console.error("submit_action failed:", err);
    return sendError(res, 502, "game_server_unavailable", "Could not reach the game server.");
  }
}
