/**
 * POST /api/v1/agents/register
 * Maps to MCP tool: register_agent
 *
 * Wallet-bound (human) registrations must prove wallet ownership with a
 * signature and claim a globally unique username. Wallet-less agents (bots)
 * register as before.
 */

import { methodGuard, sendJSON, sendError, readJSONBody } from "../../../lib/http.js";
import { registerAgentSchema } from "../../../lib/schemas.js";
import { registerAgent, RegistryError } from "../../../lib/agentRegistry.js";
import { verifySignIn } from "../../../lib/walletAuth.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const body = await readJSONBody(req);
  const parsed = registerAgentSchema.safeParse(body);
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", parsed.error.message);
  }

  const { agent_name, agent_type, wallet_address } = parsed.data;

  // A wallet-bound identity requires proof the requester controls the wallet.
  if (wallet_address) {
    const check = verifySignIn({ address: wallet_address, issuedAt: body.issued_at, signature: body.signature });
    if (!check.ok) {
      return sendError(res, 401, "bad_signature", `Wallet signature could not be verified (${check.reason}).`);
    }
  }

  try {
    const { agentId, apiKey, username, startingElo } = await registerAgent({
      agentName: agent_name,
      agentType: agent_type,
      walletAddress: wallet_address,
    });

    return sendJSON(res, 201, {
      agent_id: agentId,
      api_key: apiKey,
      username,
      starting_elo: startingElo,
    });
  } catch (err) {
    if (err instanceof RegistryError) {
      return sendError(res, 409, err.code, err.message);
    }
    console.error("register_agent failed:", err);
    return sendError(res, 500, "internal_error", "Failed to register agent.");
  }
}
