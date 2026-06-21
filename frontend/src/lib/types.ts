/**
 * src/lib/types.ts
 * Mirrors the data shapes defined in the backend's MCP spec (bluffline_mcp.json)
 * and lib/game/engine.js, so frontend and backend stay aligned on contract shape.
 */

export type AgentType = "human" | "rule_based" | "llm" | "hybrid";

export type ClaimType = "high_card" | "pair" | "two_pair" | "straight_run" | "set";

export interface Claim {
  claim_type: ClaimType;
  rank_threshold: number; // 1-9
  suit_count?: number;
  claimantSeat?: number; // seat that made this standing claim (set by the server)
}

export interface Card {
  suit: "spades" | "hearts" | "diamonds" | "clubs";
  rank: number; // 1-9
}

export interface Seat {
  seatIndex: number;
  agentId: string;
  agentName: string;
  agentType: AgentType;
  isHouse?: boolean;
}

export interface RegisterAgentResponse {
  agent_id: string;
  api_key: string;
  starting_elo: number;
}

export interface FindTableResponse {
  table_id: string;
  seat_index: number;
  websocket_join_url: string;
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  agentType: AgentType;
  elo: number;
  matchesPlayed: number;
}

export interface LeaderboardResponse {
  as_of_block: number | null;
  rankings: LeaderboardEntry[];
}

export interface OpenTable {
  table_id: string;
  players: number;
  min_players: number;
  capacity: number;
  phase: string; // "waiting" | "countdown"
}

export interface TablesResponse {
  tables: OpenTable[];
}

export interface MatchStanding {
  seatIndex: number;
  agentId: string;
  agentType: AgentType;
  placement: number;
  finalChips: number;
}

export interface MatchLogAction {
  sequence: number;
  seatIndex: number | null;
  actionType: "deal_commit" | "claim" | "bluff_call" | "reveal";
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface MatchLogResponse {
  storage_content_hash: string;
  deal_commitment_hash: string;
  actions: MatchLogAction[];
  final_hands: Record<string, Card[]> | null;
}

export interface VerifyMatchResponse {
  match_id: string;
  chain_tx_hash: string | null;
  storage_content_hash: string;
  recomputed_result_matches_chain: boolean;
  final_standings: {
    agent_id: string;
    agent_type: string;
    placement: number;
    elo_delta: number;
  }[];
}

/** WebSocket event payloads, matching ws-server/server.js broadcasts. */
export type WSEvent =
  | { event: "match_started"; payload: { match_id: string; table_id: string; seats: Seat[]; chips: Record<number, number> } }
  | { event: "countdown_started"; payload: { table_id: string; seconds: number; ends_at: number; seats: Seat[]; min_players: number; capacity: number } }
  | { event: "countdown_cancelled"; payload: { table_id: string; min_players: number; players: number } }
  | { event: "table_update"; payload: { table_id: string; seats: Seat[]; phase: string; min_players: number; capacity: number } }
  | { event: "round_started"; payload: { match_id: string; round: number; deal_commitment_hash: string; active_seats: number[] } }
  | { event: "hand_dealt"; payload: { match_id: string; seat_index: number; hand: Card[]; deal_commitment_hash: string } }
  | { event: "your_turn"; payload: { match_id: string; current_claim: Claim | null; time_limit_seconds: number } }
  | { event: "claim_made"; payload: { match_id: string; seat_index: number; claim: Claim } }
  | { event: "bluff_called"; payload: { match_id: string; calling_seat: number; claimant_seat: number } }
  | {
      event: "hand_revealed";
      payload: {
        match_id: string;
        hands: Record<number, Card[]>;
        claim_result: "claim_held" | "claim_was_bluff";
        round_loser_seat: number;
        round_winner_seat: number;
        chips: Record<number, number>;
      };
    }
  | {
      event: "match_completed";
      payload: { match_id: string; final_standings: MatchStanding[]; storage_content_hash: string | null; chain_tx_hash: string | null };
    }
  | { event: "action_rejected"; payload: { reason: string } }
  | { event: "turn_skipped"; payload: { match_id: string; seat_index: number; consecutive_timeouts: number; warning: boolean; away_at: number } }
  | { event: "player_left"; payload: { match_id: string; seat_index: number; reason: string } }
  | { event: "error"; payload: { message: string } };
