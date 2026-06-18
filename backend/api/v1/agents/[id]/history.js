/**
 * GET /api/v1/agents/[id]/history
 * Backs resource: bluffline://agents/{agent_id}/history
 */

import { methodGuard, sendJSON, sendError } from "../../../../lib/http.js";
import { getAgentById } from "../../../../lib/agentRegistry.js";
import { fetchJSON } from "../../../../lib/storage/zerogStorageClient.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;

  const { id } = req.query;
  const agent = await getAgentById(id);
  if (!agent) {
    return sendError(res, 404, "agent_not_found", `No agent found with id ${id}`);
  }

  // NOTE: v1 stores a per-agent match-id index alongside the agent record
  // (or in a KV list) so this endpoint can resolve to a list of match logs.
  // Scaffolded here assuming agent.matchIds is populated on match completion.
  const matchIds = agent.matchIds || [];

  const matches = await Promise.all(
    matchIds.map(async (matchId) => {
      try {
        const log = await fetchJSON(agent.matchLogHashes?.[matchId]);
        return { matchId, summary: log.standings };
      } catch {
        return { matchId, summary: null, error: "log_unavailable" };
      }
    })
  );

  return sendJSON(res, 200, {
    agent_id: agent.agentId,
    agent_name: agent.agentName,
    current_elo: agent.elo,
    matches_played: agent.matchesPlayed,
    matches,
  });
}
