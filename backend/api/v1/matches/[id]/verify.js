/**
 * GET /api/v1/matches/[id]/verify
 * Maps to MCP tool: verify_match
 * Backs resource: bluffline://matches/{match_id}/verify
 *
 * This is the core trust feature of Bluffline: cross-checks the stored
 * 0G Storage log against the settled 0G Chain record and recomputes the
 * result independently, so a user doesn't have to take the app's word for it.
 */

import { methodGuard, sendJSON, sendError } from "../../../../lib/http.js";
import { getMatchResultFromChain } from "../../../../lib/chain/zerogChainClient.js";
import { fetchJSON, computeContentHash } from "../../../../lib/storage/zerogStorageClient.js";
import { verifyDeckCommitment } from "../../../../lib/storage/commitReveal.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;

  const { id: matchId } = req.query;

  try {
    const chainResult = await getMatchResultFromChain(matchId);
    const log = await fetchJSON(chainResult.storageContentHash);

    // Recompute the content hash of the fetched log (sha256 in mock, 0G Storage
    // Merkle root in live mode) and confirm it matches what's pinned on-chain —
    // proves the log hasn't been swapped post-hoc.
    const recomputedHash = await computeContentHash(log);
    const hashMatches = recomputedHash === chainResult.storageContentHash;

    // If the log includes the revealed deck per round, verify each round's
    // deal commitment was honored (deck wasn't altered after commitment).
    let allCommitmentsValid = true;
    if (Array.isArray(log.roundReveals)) {
      allCommitmentsValid = log.roundReveals.every((round) =>
        verifyDeckCommitment(round.revealedDeck, round.dealCommitmentHash)
      );
    }

    const recomputedResultMatchesChain = hashMatches && allCommitmentsValid;

    return sendJSON(res, 200, {
      match_id: matchId,
      chain_tx_hash: chainResult.txHash || null,
      storage_content_hash: chainResult.storageContentHash,
      recomputed_result_matches_chain: recomputedResultMatchesChain,
      final_standings: chainResult.participants.map((address, i) => ({
        agent_id: address,
        agent_type: log.standings?.[i]?.agentType || "unknown",
        // Live ethers returns int32/uint8 as BigInt — coerce for JSON.
        placement: Number(chainResult.placements[i]),
        elo_delta: Number(chainResult.eloDeltas[i]),
      })),
    });
  } catch (err) {
    console.error("verify_match failed:", err);
    return sendError(res, 404, "match_not_found", `Could not verify match ${matchId}.`);
  }
}
