/**
 * POST /api/v1/agents/username
 *
 * Change the authenticated agent's username (globally unique). Auth is the
 * existing API key — the player is already signed in.
 */

import { methodGuard, sendJSON, sendError, readJSONBody, getApiKey } from "../../../lib/http.js";
import { getAgentByApiKey, changeUsername, RegistryError } from "../../../lib/agentRegistry.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const agent = await getAgentByApiKey(getApiKey(req));
  if (!agent) {
    return sendError(res, 401, "unauthorized", "Missing or invalid X-Agent-Key header.");
  }

  const body = await readJSONBody(req);
  const newName = String(body.username || "").trim();
  if (!newName) {
    return sendError(res, 400, "invalid_username", "A username is required.");
  }

  try {
    const updated = await changeUsername(agent.agentId, newName);
    return sendJSON(res, 200, { agent_id: updated.agentId, username: updated.agentName });
  } catch (err) {
    if (err instanceof RegistryError) {
      return sendError(res, 409, err.code, err.message);
    }
    console.error("change_username failed:", err);
    return sendError(res, 500, "internal_error", "Failed to change username.");
  }
}
