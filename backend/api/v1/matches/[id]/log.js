/**
 * GET /api/v1/matches/[id]/log
 * Maps to MCP tool: get_match_log
 * Backs resource: bluffline://matches/{match_id}/log
 */

import { methodGuard, sendJSON, sendError } from "../../../../lib/http.js";
import { getMatchResultFromChain } from "../../../../lib/chain/zerogChainClient.js";
import { fetchJSON } from "../../../../lib/storage/zerogStorageClient.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;

  const { id: matchId } = req.query;

  try {
    // The chain record gives us the 0G Storage content hash for this match.
    const chainResult = await getMatchResultFromChain(matchId);
    const log = await fetchJSON(chainResult.storageContentHash);

    return sendJSON(res, 200, {
      storage_content_hash: chainResult.storageContentHash,
      deal_commitment_hash: log.dealCommitmentHash,
      actions: log.actionLog,
      final_hands: log.finalHands || null,
    });
  } catch (err) {
    console.error("get_match_log failed:", err);
    return sendError(res, 404, "match_not_found", `Could not retrieve log for match ${matchId}.`);
  }
}
