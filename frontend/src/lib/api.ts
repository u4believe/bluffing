/**
 * src/lib/api.ts
 * Thin client for the Bluffline backend's REST API (see bluffline-backend/api/v1/...).
 */

import type {
  RegisterAgentResponse,
  FindTableResponse,
  LeaderboardResponse,
  MatchLogResponse,
  VerifyMatchResponse,
  TablesResponse,
  AgentType,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001/v1";

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const code = body?.error?.code || "unknown_error";
    const message = body?.error?.message || `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }

  return body as T;
}

export async function registerAgent(params: {
  agentName: string;
  agentType: AgentType;
  walletAddress?: string;
}): Promise<RegisterAgentResponse> {
  return request<RegisterAgentResponse>("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      agent_name: params.agentName,
      agent_type: params.agentType,
      wallet_address: params.walletAddress,
    }),
  });
}

export async function findTable(
  apiKey: string,
  params: { preferredSeatCount?: number; includeHouseAgent?: boolean; minPlayers?: number } = {}
): Promise<FindTableResponse> {
  return request<FindTableResponse>("/tables/find", {
    method: "POST",
    headers: { "X-Agent-Key": apiKey },
    body: JSON.stringify({
      preferred_seat_count: params.preferredSeatCount ?? 6,
      include_house_agent: params.includeHouseAgent ?? true,
      min_players: params.minPlayers ?? 2,
    }),
  });
}

export async function joinTable(apiKey: string, tableId: string): Promise<FindTableResponse> {
  return request<FindTableResponse>(`/tables/${tableId}/join`, {
    method: "POST",
    headers: { "X-Agent-Key": apiKey },
  });
}

export async function listOpenTables(): Promise<TablesResponse> {
  return request<TablesResponse>("/tables");
}

export async function leaveCurrentTable(apiKey: string): Promise<{ left: boolean }> {
  return request<{ left: boolean }>("/tables/leave", {
    method: "POST",
    headers: { "X-Agent-Key": apiKey },
  });
}

export async function getLeaderboard(params: { limit?: number; agentTypeFilter?: string } = {}): Promise<LeaderboardResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.agentTypeFilter) query.set("agent_type_filter", params.agentTypeFilter);
  return request<LeaderboardResponse>(`/leaderboard?${query.toString()}`);
}

export async function getMatchLog(matchId: string): Promise<MatchLogResponse> {
  return request<MatchLogResponse>(`/matches/${matchId}/log`);
}

export async function verifyMatch(matchId: string): Promise<VerifyMatchResponse> {
  return request<VerifyMatchResponse>(`/matches/${matchId}/verify`);
}

export { ApiError, API_BASE_URL };
