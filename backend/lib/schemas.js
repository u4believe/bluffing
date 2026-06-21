/**
 * lib/schemas.js
 * Zod schemas validating request bodies against the MCP spec's input_schema definitions.
 */

import { z } from "zod";

export const registerAgentSchema = z.object({
  agent_name: z.string().min(1).max(64),
  agent_type: z.enum(["human", "rule_based", "llm", "hybrid"]),
  wallet_address: z.string().optional(),
});

export const findTableSchema = z.object({
  preferred_seat_count: z.number().int().min(2).max(6).default(6),
  include_house_agent: z.boolean().default(true),
  min_players: z.number().int().min(2).max(6).default(2),
});

export const claimSchema = z.object({
  claim_type: z.enum(["high_card", "pair", "two_pair", "straight_run", "set"]),
  rank_threshold: z.number().int().min(1).max(9),
  suit_count: z.number().int().min(1).max(4).optional(),
});

export const submitActionSchema = z.object({
  table_id: z.string(),
  match_id: z.string(),
  action_type: z.enum(["claim", "bluff_call"]),
  claim: claimSchema.optional(),
});
