/**
 * GET /api/v1/leaderboard
 * Maps to MCP tool: get_leaderboard
 * Backs resource: bluffline://leaderboard
 */

import { methodGuard, sendJSON, sendError } from "../../../lib/http.js";
import { listLeaderboard } from "../../../lib/agentRegistry.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const agentTypeFilter = req.query.agent_type_filter || "all";

  try {
    const rankings = await listLeaderboard({ limit, agentTypeFilter });
    return sendJSON(res, 200, {
      as_of_block: null, // populate once leaderboard is read directly from chain rather than KV cache
      rankings,
    });
  } catch (err) {
    console.error("get_leaderboard failed:", err);
    return sendError(res, 500, "internal_error", "Failed to load leaderboard.");
  }
}
