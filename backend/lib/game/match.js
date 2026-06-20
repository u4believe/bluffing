/**
 * lib/game/match.js
 *
 * In-memory match state machine for a single table of "Tell".
 * Owned and mutated by the WebSocket server process (see ws-server/).
 * The Vercel API never holds match state directly — it only reads
 * completed match logs from 0G Storage and chain settlement records.
 */

import { nanoid } from "nanoid";
import {
  buildDeck,
  shuffleDeck,
  dealHands,
  isValidRaise,
  resolveBluffCall,
} from "./engine.js";
import { hashDeckCommitment } from "../storage/commitReveal.js";

export const MATCH_STATUS = {
  WAITING: "waiting",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

export class Match {
  constructor({ tableId, seats, startingChips = 1000 }) {
    this.matchId = nanoid();
    this.tableId = tableId;
    this.seats = seats; // [{ seatIndex, agentId, agentName, agentType }]
    this.chips = Object.fromEntries(seats.map((s) => [s.seatIndex, startingChips]));
    this.status = MATCH_STATUS.WAITING;
    this.actionLog = [];
    this.round = 0;
    this.currentClaim = null;
    this.currentTurnSeat = 0;
    this.hands = null;
    this.deckCommitmentHash = null;
    this.activeSeats = seats.map((s) => s.seatIndex);
    // Consecutive missed turns per seat — escalates to a faster clock then removal.
    this.consecutiveTimeouts = Object.fromEntries(seats.map((s) => [s.seatIndex, 0]));
  }

  /** Begin a new round: shuffle, commit hash, deal hands. */
  startRound(rng = Math.random) {
    const deck = shuffleDeck(buildDeck(), rng);
    this.deckCommitmentHash = hashDeckCommitment(deck);
    const { hands } = dealHands(deck, this.activeSeats.length);

    this.hands = {};
    this.activeSeats.forEach((seatIndex, i) => {
      this.hands[seatIndex] = hands[i];
    });

    this.status = MATCH_STATUS.IN_PROGRESS;
    this.round += 1;
    this.currentClaim = null;
    this.currentTurnSeat = this.activeSeats[this.round % this.activeSeats.length];

    this._log("deal_commit", null, {
      deck_commitment_hash: this.deckCommitmentHash,
      active_seats: this.activeSeats,
      round: this.round,
    });

    return {
      matchId: this.matchId,
      deckCommitmentHash: this.deckCommitmentHash,
      activeSeats: this.activeSeats,
    };
  }

  /** Submit a claim action for the current turn's seat. */
  submitClaim(seatIndex, claim) {
    this._assertTurn(seatIndex);
    if (!isValidRaise(this.currentClaim, claim)) {
      return { accepted: false, reason: "claim_does_not_outrank_current_claim" };
    }
    this.currentClaim = { ...claim, claimantSeat: seatIndex };
    this._log("claim", seatIndex, { claim });
    this._advanceTurn();
    return { accepted: true, nextTurnSeat: this.currentTurnSeat };
  }

  /** Submit a bluff call for the current turn's seat against the standing claim. */
  submitBluffCall(seatIndex) {
    this._assertTurn(seatIndex);
    if (!this.currentClaim) {
      return { accepted: false, reason: "no_standing_claim_to_call" };
    }

    const claimantSeat = this.currentClaim.claimantSeat;
    const combinedHands = this.activeSeats.map((s) => this.hands[s]);
    const { claimHolds, loserSeat, evidence } = resolveBluffCall({
      claimantSeat,
      callingSeat: seatIndex,
      claim: this.currentClaim,
      combinedHands,
    });

    // The showdown is a duel between the caller and the claimant — the winner
    // is whichever of them didn't lose.
    const winnerSeat = loserSeat === seatIndex ? claimantSeat : seatIndex;

    this._log("bluff_call", seatIndex, { claim: this.currentClaim });
    this._log("reveal", null, {
      hands: this.hands,
      claimHolds,
      loserSeat,
      winnerSeat,
      evidence,
    });

    this._applyRoundResult(loserSeat, winnerSeat);

    return {
      accepted: true,
      claimHolds,
      loserSeat,
      winnerSeat,
      revealedHands: this.hands,
    };
  }

  /** Returns true if the match should end (one or fewer seats with chips remaining). */
  isMatchOver() {
    const remaining = this.activeSeats.filter((s) => this.chips[s] > 0);
    return remaining.length <= 1;
  }

  /** Finalize the match: compute standings, return data for 0G Storage + Chain writes. */
  finalize() {
    this.status = MATCH_STATUS.COMPLETED;
    const standings = [...this.seats]
      .sort((a, b) => this.chips[b.seatIndex] - this.chips[a.seatIndex])
      .map((seat, idx) => ({
        seatIndex: seat.seatIndex,
        agentId: seat.agentId,
        agentType: seat.agentType,
        placement: idx + 1,
        finalChips: this.chips[seat.seatIndex],
      }));

    return {
      matchId: this.matchId,
      tableId: this.tableId,
      actionLog: this.actionLog,
      standings,
    };
  }

  /**
   * Forfeit a seat (left the table or timed out): zero their chips and drop
   * them from active play. If it was their turn, move it to the next active
   * seat. The match ends (isMatchOver) once one or fewer seats remain.
   */
  /** Skip the current turn without acting (used on timeout). Returns the next seat. */
  skipCurrentTurn() {
    this._advanceTurn();
    return this.currentTurnSeat;
  }

  forfeit(seatIndex) {
    this.chips[seatIndex] = 0;
    const wasTheirTurn = this.currentTurnSeat === seatIndex;
    this.activeSeats = this.activeSeats.filter((s) => s !== seatIndex && this.chips[s] > 0);
    if (wasTheirTurn && this.activeSeats.length > 0) {
      this.currentTurnSeat = this.activeSeats[0];
    }
  }

  _applyRoundResult(loserSeat, winnerSeat) {
    // Zero-sum transfer: the loser pays the winner. The winner gains exactly
    // what the loser can pay (≤100), so total chips at the table are conserved.
    const penalty = Math.min(100, this.chips[loserSeat]);
    this.chips[loserSeat] -= penalty;
    if (winnerSeat !== undefined && this.chips[winnerSeat] !== undefined) {
      this.chips[winnerSeat] += penalty;
    }
    this.activeSeats = this.activeSeats.filter((s) => this.chips[s] > 0);
  }

  _advanceTurn() {
    const idx = this.activeSeats.indexOf(this.currentTurnSeat);
    this.currentTurnSeat = this.activeSeats[(idx + 1) % this.activeSeats.length];
  }

  _assertTurn(seatIndex) {
    if (seatIndex !== this.currentTurnSeat) {
      throw new Error(`not_your_turn: expected seat ${this.currentTurnSeat}, got ${seatIndex}`);
    }
  }

  _log(actionType, seatIndex, payload) {
    this.actionLog.push({
      sequence: this.actionLog.length,
      seatIndex,
      actionType,
      payload,
      timestamp: new Date().toISOString(),
    });
  }
}
