/**
 * ws-server/server.js
 *
 * Standalone Node process holding live match state for Bluffline.
 * Deploy this separately from the Vercel API (e.g. Railway, Fly.io, Render) —
 * Vercel serverless functions cannot hold persistent WebSocket connections
 * or long-lived in-memory game state across requests.
 *
 * Responsibilities:
 *   - Accept WebSocket connections from human browser clients and agents.
 *   - Run table matchmaking and own all live Match instances.
 *   - Push game-state events per the MCP websocket_events spec.
 *   - On match completion: upload the log to 0G Storage, settle to 0G Chain,
 *     update the agent registry, and broadcast match_completed.
 *   - Expose small internal HTTP endpoints (/internal/matchmake, /internal/action)
 *     that the Vercel API proxies to, authenticated via a shared secret.
 */

import http from "node:http";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import { Match } from "../lib/game/match.js";
import { uploadJSON } from "../lib/storage/zerogStorageClient.js";
import { recordMatchOnChain } from "../lib/chain/zerogChainClient.js";
import { agentIdToAddress } from "../lib/chain/agentAddress.js";
import { updateElo } from "../lib/game/engine.js";
import { getAgentById, updateAgentStats } from "../lib/agentRegistry.js";

const PORT = process.env.PORT || 8080;
const SHARED_SECRET = process.env.WS_SERVER_INTERNAL_SHARED_SECRET;
const HOUSE_AGENT_ID = "the_dealer";

// --- In-memory state owned by this process ---
const tables = new Map(); // tableId -> { tableId, seats: [], match: Match|null, sockets: Map<seatIndex, ws> }
const waitingQueue = []; // tableIds with open seats, FIFO for simple matchmaking

function createTable(preferredSeatCount) {
  const tableId = nanoid();
  const table = { tableId, capacity: preferredSeatCount, seats: [], match: null, sockets: new Map() };
  tables.set(tableId, table);
  waitingQueue.push(tableId);
  return table;
}

function findOpenTable(preferredSeatCount) {
  for (const tableId of waitingQueue) {
    const table = tables.get(tableId);
    if (table && table.seats.length < table.capacity) return table;
  }
  return createTable(preferredSeatCount);
}

function maybeFillWithHouseAgent(table, includeHouseAgent) {
  if (includeHouseAgent && table.seats.length < table.capacity && table.seats.length >= 1) {
    // Simple heuristic: top up with house agent seats once at least one real
    // participant has joined, so solo players aren't stuck waiting.
    while (table.seats.length < table.capacity) {
      table.seats.push({
        seatIndex: table.seats.length,
        agentId: HOUSE_AGENT_ID,
        agentName: "The Dealer",
        agentType: "rule_based",
        isHouse: true,
      });
    }
  }
}

function broadcast(table, event, payload) {
  const message = JSON.stringify({ event, payload });
  for (const ws of table.sockets.values()) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

async function startMatchIfReady(table) {
  if (table.seats.length < 2 || table.match) return;

  const match = new Match({ tableId: table.tableId, seats: table.seats });
  table.match = match;

  // Public: who's seated at the table. Sent once when the match begins.
  broadcast(table, "match_started", {
    match_id: match.matchId,
    table_id: table.tableId,
    seats: table.seats,
  });

  beginRound(table);
}

/**
 * Begin a fresh round: shuffle/deal, announce the public deal commitment,
 * privately deal each seated player ONLY its own hand, then notify whose turn
 * it is. Used for the first round and every round after a bluff-call showdown.
 */
function beginRound(table) {
  const { match } = table;
  const { deckCommitmentHash, activeSeats } = match.startRound();

  // Public: the round opened and here's the pre-deal commitment hash. Resets
  // any standing claim / prior reveal on each client.
  broadcast(table, "round_started", {
    match_id: match.matchId,
    round: match.round,
    deal_commitment_hash: deckCommitmentHash,
    active_seats: activeSeats,
  });

  // Private: each connected seat learns ONLY its own hand. Hidden information is
  // the whole game — hands are never broadcast until a bluff-call showdown.
  for (const seatIndex of activeSeats) {
    const ws = table.sockets.get(seatIndex);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        event: "hand_dealt",
        payload: {
          match_id: match.matchId,
          seat_index: seatIndex,
          hand: match.hands[seatIndex],
          deal_commitment_hash: deckCommitmentHash,
        },
      }));
    }
  }

  notifyCurrentTurn(table);
}

function notifyCurrentTurn(table) {
  const { match } = table;
  if (!match || match.status === "completed") return;

  const ws = table.sockets.get(match.currentTurnSeat);
  const payload = {
    match_id: match.matchId,
    current_claim: match.currentClaim,
    time_limit_seconds: 30,
  };
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event: "your_turn", payload }));
  }
  driveHouseAgentIfNeeded(table);
}

/** Extremely simple built-in policy for The Dealer house agent. */
function houseAgentDecideAction(match) {
  if (!match.currentClaim) {
    return { actionType: "claim", claim: { claim_type: "high_card", rank_threshold: 3 } };
  }
  // Naive policy: escalate rank_threshold by 1 if possible, otherwise call bluff.
  // Build a clean claim — don't carry the previous claim's claimantSeat forward.
  const next = {
    claim_type: match.currentClaim.claim_type,
    rank_threshold: match.currentClaim.rank_threshold + 1,
  };
  if (next.rank_threshold <= 9) {
    return { actionType: "claim", claim: next };
  }
  return { actionType: "bluff_call" };
}

function driveHouseAgentIfNeeded(table) {
  const { match } = table;
  if (!match || match.status === "completed") return;

  const turnSeat = match.currentTurnSeat;
  const seatInfo = table.seats[turnSeat];
  if (!seatInfo || seatInfo.agentId !== HOUSE_AGENT_ID) return;
  if (table.pendingHouseTurn === turnSeat) return; // already scheduled for this turn

  table.pendingHouseTurn = turnSeat;
  setTimeout(() => {
    table.pendingHouseTurn = null;
    // Re-check at fire time: only act if this exact match is still live and it's
    // STILL this house seat's turn. Guards against acting as the wrong seat if
    // the turn advanced while we were waiting.
    if (!table.match || table.match !== match || match.status === "completed") return;
    if (match.currentTurnSeat !== turnSeat) return;
    const decision = houseAgentDecideAction(match);
    handleAction(table, turnSeat, decision.actionType, decision.claim);
  }, 800); // small delay so the UI can show "The Dealer is thinking..."
}

async function handleAction(table, seatIndex, actionType, claim) {
  const { match } = table;
  if (!match) return { accepted: false, reason: "no_active_match" };

  let result;
  try {
    if (actionType === "claim") {
      result = match.submitClaim(seatIndex, claim);
      if (result.accepted) {
        // Broadcast the normalized standing claim (includes the correct
        // claimantSeat), not the raw client-supplied object.
        broadcast(table, "claim_made", { match_id: match.matchId, seat_index: seatIndex, claim: match.currentClaim });
        notifyCurrentTurn(table);
      }
    } else if (actionType === "bluff_call") {
      result = match.submitBluffCall(seatIndex);
      if (result.accepted) {
        broadcast(table, "bluff_called", {
          match_id: match.matchId,
          calling_seat: seatIndex,
          claimant_seat: match.currentClaim.claimantSeat,
        });
        broadcast(table, "hand_revealed", {
          match_id: match.matchId,
          hands: result.revealedHands,
          claim_result: result.claimHolds ? "claim_held" : "claim_was_bluff",
          round_loser_seat: result.loserSeat,
        });

        if (match.isMatchOver()) {
          await finalizeMatch(table);
        } else {
          beginRound(table); // re-deal, send fresh private hands, notify turn
        }
      }
    } else {
      result = { accepted: false, reason: "unknown_action_type" };
    }
  } catch (err) {
    result = { accepted: false, reason: err.message };
  }

  // If the action was rejected, tell the acting player — otherwise their UI
  // stays frozen (it optimistically cleared their turn). Re-prompt them when
  // it's still their turn (e.g. a claim that didn't outrank the standing one),
  // so the table can't deadlock.
  if (!result.accepted) {
    const ws = table.sockets.get(seatIndex);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "action_rejected", payload: { reason: result.reason } }));
      if (match && match.currentTurnSeat === seatIndex && match.status !== "completed") {
        ws.send(JSON.stringify({
          event: "your_turn",
          payload: { match_id: match.matchId, current_claim: match.currentClaim, time_limit_seconds: 30 },
        }));
      }
    }
  }

  return result;
}

async function finalizeMatch(table) {
  const { match } = table;
  const { matchId, actionLog, standings } = match.finalize();

  const logPayload = {
    matchId,
    tableId: table.tableId,
    actionLog,
    standings,
    finalizedAt: new Date().toISOString(),
  };

  let storageContentHash;
  try {
    const { contentHash } = await uploadJSON(logPayload);
    storageContentHash = contentHash;
  } catch (err) {
    console.error("0G Storage upload failed for match", matchId, err);
    storageContentHash = null;
  }

  // Fetch each participant's registry record once (for current ELO + any
  // linked wallet address). Keyed by agentId; house agent has no record.
  const agentRecords = {};
  for (const s of standings) {
    if (!(s.agentId in agentRecords)) agentRecords[s.agentId] = await getAgentById(s.agentId);
  }

  // Compute ELO deltas pairwise against the winner for simplicity in v1.
  const winner = standings[0];
  const eloUpdates = [];
  for (const participant of standings) {
    if (participant.seatIndex === winner.seatIndex) continue;
    const winnerElo = agentRecords[winner.agentId]?.elo ?? 1200;
    const loserElo = agentRecords[participant.agentId]?.elo ?? 1200;
    const { winnerDelta, loserDelta } = updateElo(winnerElo, loserElo);
    eloUpdates.push({ agentId: winner.agentId, delta: winnerDelta });
    eloUpdates.push({ agentId: participant.agentId, delta: loserDelta });
  }

  for (const { agentId, delta } of eloUpdates) {
    if (agentId === HOUSE_AGENT_ID) continue; // house agent doesn't need persisted stats
    await updateAgentStats(agentId, { eloDelta: delta });
  }

  let chainTxHash = null;
  if (storageContentHash) {
    try {
      // Settle under each participant's on-chain address (linked wallet, else a
      // deterministic placeholder) — the contract expects address[], not agentIds.
      const participants = standings.map((s) =>
        agentIdToAddress(s.agentId, agentRecords[s.agentId]?.walletAddress)
      );
      const eloDeltas = standings.map(
        (s) => eloUpdates.find((u) => u.agentId === s.agentId)?.delta || 0
      );
      const placements = standings.map((s) => s.placement);
      const { txHash } = await recordMatchOnChain({
        matchId,
        storageContentHash,
        participants,
        eloDeltas,
        placements,
      });
      chainTxHash = txHash;
    } catch (err) {
      console.error("0G Chain settlement failed for match", matchId, err);
    }
  }

  broadcast(table, "match_completed", {
    match_id: matchId,
    final_standings: standings,
    storage_content_hash: storageContentHash,
    chain_tx_hash: chainTxHash,
  });

  tables.delete(table.tableId);
  const queueIdx = waitingQueue.indexOf(table.tableId);
  if (queueIdx !== -1) waitingQueue.splice(queueIdx, 1);
}

// --- HTTP server: internal endpoints + WS upgrade ---

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/internal/matchmake") {
    if (req.headers["x-internal-secret"] !== SHARED_SECRET) {
      res.writeHead(401).end(JSON.stringify({ message: "unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { agentId, agentName, agentType, preferredSeatCount, includeHouseAgent, tableId } = JSON.parse(body);

      let table;
      if (tableId) {
        // Joining a SPECIFIC table via an invite link, not open matchmaking.
        table = tables.get(tableId);
        if (!table) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "table_not_found" }));
          return;
        }
        if (table.match) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "match_already_started" }));
          return;
        }
        if (table.seats.length >= table.capacity) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "table_full" }));
          return;
        }
      } else {
        table = findOpenTable(preferredSeatCount || 4);
      }

      const seatIndex = table.seats.length;
      table.seats.push({ seatIndex, agentId, agentName, agentType, isHouse: false });
      // Only auto-fill with The Dealer for open matchmaking — never for an invite.
      if (!tableId) maybeFillWithHouseAgent(table, includeHouseAgent);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tableId: table.tableId, seatIndex }));
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/action") {
    if (req.headers["x-internal-secret"] !== SHARED_SECRET) {
      res.writeHead(401).end(JSON.stringify({ message: "unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const { agentId, tableId, actionType, claim } = JSON.parse(body);
      const table = tables.get(tableId);
      if (!table || !table.match) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, message: "table_or_match_not_found" }));
        return;
      }
      const seatInfo = table.seats.find((s) => s.agentId === agentId);
      if (!seatInfo) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, message: "agent_not_seated_at_table" }));
        return;
      }
      const result = await handleAction(table, seatInfo.seatIndex, actionType, claim);
      res.writeHead(result.accepted ? 200 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/v1/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tableId = url.searchParams.get("table_id");
  // agent_key would be verified against the agent registry in a full implementation;
  // omitted here for brevity since the HTTP layer already authenticates find_table.

  const table = tables.get(tableId);
  if (!table) {
    ws.send(JSON.stringify({ event: "error", payload: { message: "table_not_found" } }));
    ws.close();
    return;
  }

  // Associate this socket with the most recently joined human/agent seat
  // that doesn't yet have a live socket attached.
  const seat = table.seats.find((s) => !table.sockets.has(s.seatIndex));
  if (seat) {
    table.sockets.set(seat.seatIndex, ws);
  }

  startMatchIfReady(table);

  ws.on("message", (raw) => {
    try {
      const { actionType, claim } = JSON.parse(raw.toString());
      if (seat) handleAction(table, seat.seatIndex, actionType, claim);
    } catch (err) {
      ws.send(JSON.stringify({ event: "error", payload: { message: "invalid_message" } }));
    }
  });

  ws.on("close", () => {
    if (seat) table.sockets.delete(seat.seatIndex);
  });
});

server.listen(PORT, () => {
  console.log(`Bluffline WS game server listening on :${PORT}`);
});
