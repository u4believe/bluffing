/**
 * POST /api/v1/agents/login
 *
 * Wallet sign-in. The client signs a message proving control of the wallet; if
 * an agent already exists for that wallet we issue a fresh API key and return
 * the identity. Otherwise { exists: false } — the client then registers with a
 * chosen username.
 */

import { methodGuard, sendJSON, sendError, readJSONBody } from "../../../lib/http.js";
import { getAgentByWallet, issueApiKey } from "../../../lib/agentRegistry.js";
import { verifySignIn } from "../../../lib/walletAuth.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const body = await readJSONBody(req);
  const check = verifySignIn({ address: body.address, issuedAt: body.issued_at, signature: body.signature });
  if (!check.ok) {
    return sendError(res, 401, "bad_signature", `Wallet signature could not be verified (${check.reason}).`);
  }

  try {
    const agent = await getAgentByWallet(check.address);
    if (!agent) {
      return sendJSON(res, 200, { exists: false });
    }
    const apiKey = await issueApiKey(agent.agentId);
    return sendJSON(res, 200, {
      exists: true,
      agent_id: agent.agentId,
      api_key: apiKey,
      username: agent.agentName,
      elo: agent.elo,
      wallet_address: agent.walletAddress,
    });
  } catch (err) {
    console.error("login failed:", err);
    return sendError(res, 500, "internal_error", "Sign-in failed.");
  }
}
