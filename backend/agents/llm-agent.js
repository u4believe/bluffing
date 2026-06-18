/**
 * agents/llm-agent.js
 *
 * Reference agent that prompts an LLM (Anthropic's Claude, via the Messages
 * API) on each turn to decide a claim or bluff call. Demonstrates the
 * minimal pattern other teams can fork to plug any model into Bluffline.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 *
 * Usage:
 *   node agents/llm-agent.js <api_base_url> <ws_base_url>
 */

import WebSocket from "ws";

const API_BASE_URL = process.argv[2] || "http://localhost:3000/v1";
const WS_BASE_URL = process.argv[3] || "ws://localhost:8080/v1/ws";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function registerAgent() {
  const response = await fetch(`${API_BASE_URL}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_name: "Reference LLM Bot", agent_type: "llm" }),
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

/** Ask Claude to decide the next action given the current game state. */
async function decideActionWithLLM({ hand, currentClaim }) {
  const systemPrompt = `You are playing Tell, a bluffing card game. Claims escalate in this ladder order: high_card < pair < two_pair < straight_run < set, and within the same type, higher rank_threshold outranks lower. You must either raise the claim (a claim that strictly outranks the current one) or call bluff. Respond with ONLY a JSON object: {"actionType": "claim", "claim": {"claim_type": "...", "rank_threshold": N}} or {"actionType": "bluff_call"}.`;

  const userPrompt = `Your hand: ${JSON.stringify(hand)}\nCurrent claim on the table: ${
    currentClaim ? JSON.stringify(currentClaim) : "none (you may open with any claim)"
  }\nDecide your action.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.find((block) => block.type === "text")?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to a safe default if the model response wasn't parseable JSON.
    return currentClaim ? { actionType: "bluff_call" } : { actionType: "claim", claim: { claim_type: "high_card", rank_threshold: 3 } };
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY in the environment before running this agent.");
    process.exit(1);
  }

  const { agent_id, api_key } = await registerAgent();
  console.log(`Registered as agent ${agent_id}`);

  const { table_id, seat_index } = await findTable(api_key);
  console.log(`Joined table ${table_id} at seat ${seat_index}`);

  const ws = new WebSocket(`${WS_BASE_URL}?table_id=${table_id}&agent_key=${api_key}`);
  let myHand = null; // populated from the private hand_dealt event each round

  ws.on("message", async (raw) => {
    const { event, payload } = JSON.parse(raw.toString());
    console.log(`[event] ${event}`, payload);

    if (event === "hand_dealt") {
      // Private deal — only this seat's own three cards. Drives the LLM's reasoning.
      myHand = payload.hand;
    }

    if (event === "your_turn") {
      const decision = await decideActionWithLLM({ hand: myHand, currentClaim: payload.current_claim });
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
