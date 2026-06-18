"use client";

/**
 * src/lib/useMatchSocket.ts
 * Connects to the standalone WS game server and exposes live match state.
 * See bluffline-backend/ws-server/server.js for the event contract.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Claim, Card, MatchStanding, Seat, WSEvent } from "./types";

export interface MatchSocketState {
  connected: boolean;
  seats: Seat[];
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
  } | null;
  finalStandings: MatchStanding[] | null;
  storageContentHash: string | null;
  chainTxHash: string | null;
  matchId: string | null;
  errorMessage: string | null;
}

const initialState: MatchSocketState = {
  connected: false,
  seats: [],
  myHand: null,
  round: 0,
  dealCommitmentHash: null,
  currentClaim: null,
  isYourTurn: false,
  timeLimitSeconds: null,
  lastReveal: null,
  finalStandings: null,
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
            currentClaim: null,
            lastReveal: null,
          }));
          break;
        case "round_started":
          // New round: clear the prior claim/reveal, the fresh hand arrives
          // separately via hand_dealt.
          setState((s) => ({
            ...s,
            round: parsed.payload.round,
            dealCommitmentHash: parsed.payload.deal_commitment_hash,
            currentClaim: null,
            lastReveal: null,
            myHand: null,
          }));
          break;
        case "hand_dealt":
          // Private: only this seat's own hand. Shown face-up during play.
          setState((s) => ({ ...s, myHand: parsed.payload.hand }));
          break;
        case "your_turn":
          setState((s) => ({
            ...s,
            currentClaim: parsed.payload.current_claim,
            isYourTurn: true,
            timeLimitSeconds: parsed.payload.time_limit_seconds,
          }));
          break;
        case "claim_made":
          setState((s) => ({ ...s, currentClaim: parsed.payload.claim, isYourTurn: false }));
          break;
        case "bluff_called":
          setState((s) => ({ ...s, isYourTurn: false }));
          break;
        case "hand_revealed":
          setState((s) => ({
            ...s,
            lastReveal: {
              hands: parsed.payload.hands,
              claimResult: parsed.payload.claim_result,
              roundLoserSeat: parsed.payload.round_loser_seat,
            },
          }));
          break;
        case "match_completed":
          setState((s) => ({
            ...s,
            finalStandings: parsed.payload.final_standings,
            storageContentHash: parsed.payload.storage_content_hash,
            chainTxHash: parsed.payload.chain_tx_hash,
            isYourTurn: false,
          }));
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

  return { ...state, sendAction };
}
