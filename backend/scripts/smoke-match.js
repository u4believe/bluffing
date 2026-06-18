/**
 * scripts/smoke-match.js
 *
 * End-to-end smoke test against a running WS game server. Seats one player
 * plus The Dealer, connects a WebSocket, plays the round out, and reports
 * every event the player receives — including whether the player was ever
 * told its own hand. Used to verify the live game loop without the browser.
 *
 * Usage:
 *   node scripts/smoke-match.js
 *   WS_HTTP=http://localhost:8080 WS_URL=ws://localhost:8080/v1/ws \
 *   SHARED_SECRET=dev-secret node scripts/smoke-match.js
 */

import WebSocket from "ws";

const WS_HTTP = process.env.WS_HTTP || "http://localhost:8080";
const WS_URL = process.env.WS_URL || "ws://localhost:8080/v1/ws";
const SHARED_SECRET = process.env.SHARED_SECRET || "dev-secret";

const received = []; // every event the player socket sees
let myHand = null; // populated from the private hand_dealt event
let sawHand = false; // were we ever privately told our own hand?

async function matchmake() {
  const res = await fetch(`${WS_HTTP}/internal/matchmake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": SHARED_SECRET },
    body: JSON.stringify({
      agentId: "smoke-player",
      agentName: "Smoke Player",
      agentType: "human",
      preferredSeatCount: 2,
      includeHouseAgent: true,
    }),
  });
  if (!res.ok) throw new Error(`matchmake failed: ${res.status} ${await res.text()}`);
  return res.json(); // { tableId, seatIndex }
}

function play() {
  return new Promise(async (resolve, reject) => {
    const { tableId, seatIndex } = await matchmake();
    console.log(`Seated at table ${tableId} as seat ${seatIndex}`);

    const ws = new WebSocket(`${WS_URL}?table_id=${tableId}&agent_key=smoke-key`);
    const done = (reason) => {
      try { ws.close(); } catch {}
      resolve(reason);
    };
    const timer = setTimeout(() => done("timeout"), 120000);

    ws.on("open", () => console.log("WS connected\n"));

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      received.push(msg.event);
      console.log(`← ${msg.event}`, JSON.stringify(msg.payload));

      // The private deal: this is where the player should learn its own hand.
      if (msg.event === "hand_dealt" && Array.isArray(msg.payload.hand)) {
        myHand = msg.payload.hand;
        sawHand = true;
      }

      // Respond on our turn so the round actually progresses. Escalate the
      // claim a few rungs, then call bluff — enough to drive rounds to a
      // showdown so the match eventually completes.
      if (msg.event === "your_turn") {
        const claim = msg.payload.current_claim;
        let action;
        if (!claim) {
          action = { actionType: "claim", claim: { claim_type: "high_card", rank_threshold: 2 } };
        } else if (claim.rank_threshold >= 5) {
          action = { actionType: "bluff_call" };
        } else {
          action = { actionType: "claim", claim: { claim_type: claim.claim_type, rank_threshold: claim.rank_threshold + 1 } };
        }
        console.log(`→ ${action.actionType}`, JSON.stringify(action.claim || {}), `(hand: ${JSON.stringify(myHand)})`);
        ws.send(JSON.stringify(action));
      }

      if (msg.event === "match_completed") {
        clearTimeout(timer);
        done("completed");
      }
    });

    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

play()
  .then((reason) => {
    console.log(`\n=== smoke result: ${reason} ===`);
    console.log("events seen:", received.join(", ") || "(none)");
    console.log(`player was told its own hand pre-showdown: ${sawHand ? "YES" : "NO"}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("smoke failed:", err.message);
    process.exit(1);
  });
