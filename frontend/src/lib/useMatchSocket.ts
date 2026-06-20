"use client";

/**
 * src/lib/useMatchSocket.ts
 * Connects to the standalone WS game server and exposes live match state.
 * See bluffline-backend/ws-server/server.js for the event contract.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Claim, Card, MatchStanding, Seat, WSEvent } from "./types";
import { sounds } from "./sounds";

export interface MatchSocketState {
  connected: boolean;
  seats: Seat[];
  chips: Record<number, number>;
  myHand: Card[] | null;
  round: number;
  dealCommitmentHash: string | null;
  currentClaim: Claim | null;
  isYourTurn: boolean;
  timeLimitSeconds: number | null;
  lastReveal: {
    hands: Record<number, Card[]>;
    claimResult: "claim_held" | "claim_was_bluff";
    roundLoserSeat: number;
    roundWinnerSeat?: number;
    callingSeat?: number;
    claimantSeat?: number;
    claim?: Claim | null;
  } | null;
  pendingBluff: { callingSeat: number; claimantSeat: number; claim: Claim | null } | null;
  finalStandings: MatchStanding[] | null;
  lastSkip: { seatIndex: number; consecutiveTimeouts: number; warning: boolean; awayAt: number } | null;
  forfeit: { seatIndex: number; reason: string } | null;
  storageContentHash: string | null;
  chainTxHash: string | null;
  matchId: string | null;
  errorMessage: string | null;
}

const initialState: MatchSocketState = {
  connected: false,
  seats: [],
  chips: {},
  myHand: null,
  round: 0,
  dealCommitmentHash: null,
  currentClaim: null,
  isYourTurn: false,
  timeLimitSeconds: null,
  lastReveal: null,
  pendingBluff: null,
  finalStandings: null,
  lastSkip: null,
  forfeit: null,
  storageContentHash: null,
  chainTxHash: null,
  matchId: null,
  errorMessage: null,
};

export function useMatchSocket(websocketUrl: string | null) {
  const [state, setState] = useState<MatchSocketState>(initialState);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!websocketUrl) return;

    const ws = new WebSocket(websocketUrl);
    socketRef.current = ws;

    ws.onopen = () => setState((s) => ({ ...s, connected: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));

    ws.onmessage = (raw) => {
      const parsed: WSEvent = JSON.parse(raw.data);

      switch (parsed.event) {
        case "match_started":
          setState((s) => ({
            ...s,
            matchId: parsed.payload.match_id,
            seats: parsed.payload.seats,
            chips: parsed.payload.chips ?? {},
            currentClaim: null,
            lastReveal: null,
          }));
          break;
        case "round_started":
          // New round: clear the prior claim/reveal, the fresh hand arrives
          // separately via hand_dealt.
          sounds.deal();
          setState((s) => ({
            ...s,
            round: parsed.payload.round,
            dealCommitmentHash: parsed.payload.deal_commitment_hash,
            currentClaim: null,
            lastReveal: null,
            myHand: null,
            errorMessage: null,
            lastSkip: null,
          }));
          break;
        case "hand_dealt":
          // Private: only this seat's own hand. Shown face-up during play.
          setState((s) => ({ ...s, myHand: parsed.payload.hand }));
          break;
        case "your_turn":
          sounds.yourTurn();
          setState((s) => ({
            ...s,
            currentClaim: parsed.payload.current_claim,
            isYourTurn: true,
            timeLimitSeconds: parsed.payload.time_limit_seconds,
            lastSkip: null,
          }));
          break;
        case "claim_made":
          sounds.claim();
          setState((s) => ({ ...s, currentClaim: parsed.payload.claim, isYourTurn: false }));
          break;
        case "bluff_called":
          sounds.bluff();
          // Stash who called whom + the claim being called, to narrate the reveal.
          setState((s) => ({
            ...s,
            isYourTurn: false,
            pendingBluff: {
              callingSeat: parsed.payload.calling_seat,
              claimantSeat: parsed.payload.claimant_seat,
              claim: s.currentClaim,
            },
          }));
          break;
        case "hand_revealed":
          sounds.reveal();
          setState((s) => ({
            ...s,
            chips: parsed.payload.chips ?? s.chips,
            lastReveal: {
              hands: parsed.payload.hands,
              claimResult: parsed.payload.claim_result,
              roundLoserSeat: parsed.payload.round_loser_seat,
              roundWinnerSeat: parsed.payload.round_winner_seat,
              callingSeat: s.pendingBluff?.callingSeat,
              claimantSeat: s.pendingBluff?.claimantSeat,
              claim: s.pendingBluff?.claim ?? null,
            },
            pendingBluff: null,
          }));
          break;
        case "match_completed":
          sounds.matchEnd();
          setState((s) => ({
            ...s,
            finalStandings: parsed.payload.final_standings,
            storageContentHash: parsed.payload.storage_content_hash,
            chainTxHash: parsed.payload.chain_tx_hash,
            isYourTurn: false,
          }));
          break;
        case "turn_skipped":
          // A player ran out of time and their turn was skipped (not a forfeit).
          // your_turn re-enables if it's now ours; otherwise we stay waiting.
          setState((s) => ({
            ...s,
            isYourTurn: false,
            lastSkip: {
              seatIndex: parsed.payload.seat_index,
              consecutiveTimeouts: parsed.payload.consecutive_timeouts,
              warning: parsed.payload.warning,
              awayAt: parsed.payload.away_at,
            },
          }));
          break;
        case "player_left":
          // A player left or timed out — they forfeit. match_completed follows.
          setState((s) => ({
            ...s,
            isYourTurn: false,
            forfeit: { seatIndex: parsed.payload.seat_index, reason: parsed.payload.reason },
          }));
          break;
        case "action_rejected":
          // The server rejected our move (e.g. claim didn't outrank). It also
          // re-sends your_turn when it's still ours, but re-enable defensively
          // and surface the reason so the player can try again.
          setState((s) => ({ ...s, isYourTurn: true, errorMessage: parsed.payload.reason }));
          break;
        case "error":
          setState((s) => ({ ...s, errorMessage: parsed.payload.message }));
          break;
      }
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [websocketUrl]);

  const sendAction = useCallback(
    (actionType: "claim" | "bluff_call", claim?: Claim) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ actionType, claim }));
      setState((s) => ({ ...s, isYourTurn: false }));
    },
    []
  );

  // Explicit leave = immediate forfeit on the server (no reconnect grace).
  const leaveMatch = useCallback(() => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ actionType: "leave" }));
    }
  }, []);

  return { ...state, sendAction, leaveMatch };
}
