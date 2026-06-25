/**
 * agents/rule-based-agent.js
 *
 * Minimal reference agent demonstrating how to integrate with the Bluffline
 * Agent API. Connects via WebSocket, plays a simple escalate-or-call policy.
 *
 * Usage:
 *   node agents/rule-based-agent.js <api_base_url> <ws_base_url>
 *
 * If BLUFFLINE_API_KEY is set (e.g. from `npm run register`), the agent reuses
 * that identity; otherwise it self-registers a throwaway one.
 *
 * Forks of this file are the expected starting point for other Zero Cup
 * teams or external developers submitting bots.
 */

import WebSocket from "ws";

const API_BASE_URL = process.argv[2] || "http://localhost:3001/v1";
const WS_BASE_URL = process.argv[3] || "ws://localhost:8080/v1/ws";
const API_KEY = process.env.BLUFFLINE_API_KEY;

async function registerAgent() {
  const response = await fetch(`${API_BASE_URL}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_name: "Reference Rule Bot", agent_type: "rule_based" }),
  });
  return response.json();
}

async function findTable(apiKey) {
  const response = await fetch(`${API_BASE_URL}/tables/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Key": apiKey },
    body: JSON.stringify({ preferred_seat_count: 2, include_house_agent: true }),
  });
  return response.json();
}

/** Decide an action given the current claim. Same naive policy as The Dealer house agent. */
function decideAction(currentClaim) {
  if (!currentClaim) {
    return { actionType: "claim", claim: { claim_type: "high_card", rank_threshold: 3 } };
  }
  const next = { ...currentClaim, rank_threshold: currentClaim.rank_threshold + 1 };
  if (next.rank_threshold <= 9) {
    return { actionType: "claim", claim: next };
  }
  return { actionType: "bluff_call" };
}

async function main() {
  let api_key = API_KEY;
  if (api_key) {
    console.log("Using BLUFFLINE_API_KEY from the environment.");
  } else {
    const registered = await registerAgent();
    api_key = registered.api_key;
    console.log(`Registered as agent ${registered.agent_id}`);
  }

  const { table_id, seat_index } = await findTable(api_key);
  console.log(`Joined table ${table_id} at seat ${seat_index}`);

  const ws = new WebSocket(`${WS_BASE_URL}?table_id=${table_id}&agent_key=${api_key}`);

  ws.on("message", (raw) => {
    const { event, payload } = JSON.parse(raw.toString());
    console.log(`[event] ${event}`, payload);

    if (event === "your_turn") {
      const decision = decideAction(payload.current_claim);
      ws.send(JSON.stringify(decision));
    }

    if (event === "match_completed") {
      console.log("Match complete:", payload.final_standings);
      ws.close();
    }
  });

  ws.on("error", (err) => console.error("WS error:", err));
}

main().catch(console.error);
