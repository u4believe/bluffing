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
// How long the showdown result stays up before the next deal (ms). Tunable.
const SHOWDOWN_PAUSE_MS = 5000;
// Per-turn time limit. A timeout SKIPS that turn; consecutive misses escalate:
// at TIMEOUT_WARNING_AT the clock shrinks to TURN_LIMIT_FAST_MS (+ a warning),
// at TIMEOUT_AWAY_AT the player is treated as away and forfeits.
const TURN_LIMIT_MS = Number(process.env.TURN_LIMIT_MS) || 20000;
const TURN_LIMIT_FAST_MS = Number(process.env.TURN_LIMIT_FAST_MS) || 10000;
const TIMEOUT_WARNING_AT = 3;
const TIMEOUT_AWAY_AT = 5;
// Grace window after a disconnect to reconnect before forfeiting.
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 20000;

/** Current per-turn limit (ms) for a seat — shrinks once they've stacked misses. */
function turnLimitMsFor(match, seat) {
  const misses = match.consecutiveTimeouts?.[seat] || 0;
  return misses >= TIMEOUT_WARNING_AT ? TURN_LIMIT_FAST_MS : TURN_LIMIT_MS;
}

// --- In-memory state owned by this process ---
const tables = new Map(); // tableId -> { tableId, seats: [], match: Match|null, sockets: Map<seatIndex, ws> }
const waitingQueue = []; // tableIds with open seats, FIFO for simple matchmaking

function createTable(preferredSeatCount) {
  const tableId = nanoid();
  const table = { tableId, capacity: preferredSeatCount, seats: [], match: null, sockets: new Map(), turnTimer: null, disconnectTimers: new Map() };
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

/** The active table a (real) agent is already seated at, if any. */
function findAgentTable(agentId) {
  for (const table of tables.values()) {
    if (table.seats.some((s) => s.agentId === agentId)) return table;
  }
  return null;
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
    chips: match.chips,
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
    time_limit_seconds: Math.round(turnLimitMsFor(match, match.currentTurnSeat) / 1000),
  };
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event: "your_turn", payload }));
  }
  armTurnTimer(table);
  driveHouseAgentIfNeeded(table);
}

/**
 * Arm a countdown for the current turn. A human seat that doesn't act within
 * TURN_LIMIT_MS forfeits the match. The house agent self-drives, so it's exempt.
 */
function armTurnTimer(table) {
  clearTimeout(table.turnTimer);
  const { match } = table;
  if (!match || match.status === "completed") return;
  const turnSeat = match.currentTurnSeat;
  const seatInfo = table.seats[turnSeat];
  if (!seatInfo || seatInfo.agentId === HOUSE_AGENT_ID) return;
  table.turnTimer = setTimeout(() => {
    if (table.match === match && match.status !== "completed" && match.currentTurnSeat === turnSeat) {
      handleTurnTimeout(table, turnSeat);
    }
  }, turnLimitMsFor(match, turnSeat));
}

/**
 * A player ran out of time. Their turn is SKIPPED. Consecutive misses escalate:
 * at TIMEOUT_AWAY_AT they're treated as away and forfeit; otherwise the turn
 * passes on (past TIMEOUT_WARNING_AT they also get a warning + a faster clock).
 */
function handleTurnTimeout(table, seatIndex) {
  const { match } = table;
  const misses = (match.consecutiveTimeouts[seatIndex] || 0) + 1;
  match.consecutiveTimeouts[seatIndex] = misses;

  if (misses >= TIMEOUT_AWAY_AT) {
    forfeitSeat(table, seatIndex, "away"); // 5 in a row → away from the table
    return;
  }

  broadcast(table, "turn_skipped", {
    match_id: match.matchId,
    seat_index: seatIndex,
    consecutive_timeouts: misses,
    warning: misses >= TIMEOUT_WARNING_AT,
    away_at: TIMEOUT_AWAY_AT,
  });

  match.skipCurrentTurn();
  notifyCurrentTurn(table);
}

/**
 * Forfeit a seat (left or timed out): they lose, remaining player(s) win.
 * Ends the match if one or fewer seats remain.
 */
async function forfeitSeat(table, seatIndex, reason) {
  const { match } = table;
  if (!match || match.status === "completed") return;
  clearTimeout(table.turnTimer);
  table.turnTimer = null;

  match.forfeit(seatIndex);
  broadcast(table, "player_left", { match_id: match.matchId, seat_index: seatIndex, reason });

  if (match.isMatchOver()) {
    await finalizeMatch(table);
  } else {
    notifyCurrentTurn(table); // continue with remaining seats (>2-player tables)
  }
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

  // The player acted — stop their turn timer and reset their miss streak (any
  // action, even a rejected one, proves they're present). notifyCurrentTurn
  // re-arms for the next turn; a rejected action re-arms below.
  clearTimeout(table.turnTimer);
  table.turnTimer = null;
  if (match.consecutiveTimeouts) match.consecutiveTimeouts[seatIndex] = 0;

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
          round_winner_seat: result.winnerSeat,
          chips: match.chips,
        });

        if (match.isMatchOver()) {
          await finalizeMatch(table);
        } else {
          // Pause so both players can read the showdown result before the next
          // deal clears it. Guard in case the table is gone by the time it fires.
          setTimeout(() => {
            if (table.match === match && match.status !== "completed") {
              beginRound(table); // re-deal, send fresh private hands, notify turn
            }
          }, SHOWDOWN_PAUSE_MS);
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
          payload: { match_id: match.matchId, current_claim: match.currentClaim, time_limit_seconds: Math.round(turnLimitMsFor(match, seatIndex) / 1000) },
        }));
        armTurnTimer(table); // still their turn — keep the clock running
      }
    }
  }

  return result;
}

async function finalizeMatch(table) {
  const { match } = table;
  // The match is ending — stop any pending turn/disconnect timers.
  clearTimeout(table.turnTimer);
  table.turnTimer = null;
  table.disconnectTimers.forEach((t) => clearTimeout(t));
  table.disconnectTimers.clear();

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

      // One player, one table: reject if this agent is already seated elsewhere.
      if (agentId && agentId !== HOUSE_AGENT_ID) {
        const existing = findAgentTable(agentId);
        if (existing) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "already_in_a_table", tableId: existing.tableId }));
          return;
        }
      }

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
    // Reconnected within the grace window — cancel any pending forfeit.
    if (table.disconnectTimers.has(seat.seatIndex)) {
      clearTimeout(table.disconnectTimers.get(seat.seatIndex));
      table.disconnectTimers.delete(seat.seatIndex);
    }
  }

  startMatchIfReady(table);

  ws.on("message", (raw) => {
    try {
      const { actionType, claim } = JSON.parse(raw.toString());
      if (!seat) return;
      if (actionType === "leave") {
        // Explicit leave = immediate forfeit (no reconnect grace).
        forfeitSeat(table, seat.seatIndex, "left");
        return;
      }
      handleAction(table, seat.seatIndex, actionType, claim);
    } catch (err) {
      ws.send(JSON.stringify({ event: "error", payload: { message: "invalid_message" } }));
    }
  });

  ws.on("close", () => {
    if (!seat) return;
    table.sockets.delete(seat.seatIndex);
    const { match } = table;
    // Live match + a real player → give a grace window to reconnect, else forfeit.
    if (match && match.status !== "completed" && seat.agentId !== HOUSE_AGENT_ID) {
      clearTimeout(table.disconnectTimers.get(seat.seatIndex));
      const timer = setTimeout(() => {
        if (table.match === match && match.status !== "completed" && !table.sockets.has(seat.seatIndex)) {
          forfeitSeat(table, seat.seatIndex, "disconnected");
        }
      }, RECONNECT_GRACE_MS);
      table.disconnectTimers.set(seat.seatIndex, timer);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bluffline WS game server listening on :${PORT}`);
});
