/**
 * POST /api/v1/agents/register
 * Maps to MCP tool: register_agent
 */

import { methodGuard, sendJSON, sendError, readJSONBody } from "../../../lib/http.js";
import { registerAgentSchema } from "../../../lib/schemas.js";
import { registerAgent } from "../../../lib/agentRegistry.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const body = await readJSONBody(req);
  const parsed = registerAgentSchema.safeParse(body);
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", parsed.error.message);
  }

  const { agent_name, agent_type, wallet_address } = parsed.data;

  try {
    const { agentId, apiKey, startingElo } = await registerAgent({
      agentName: agent_name,
      agentType: agent_type,
      walletAddress: wallet_address,
    });

    return sendJSON(res, 201, {
      agent_id: agentId,
      api_key: apiKey,
      starting_elo: startingElo,
    });
  } catch (err) {
    console.error("register_agent failed:", err);
    return sendError(res, 500, "internal_error", "Failed to register agent.");
  }
}
