/**
 * lib/agentRegistry.js
 *
 * Agent identity storage. Uses Upstash Redis in production (Vercel's native
 * Redis Marketplace integration); falls back to in-memory Maps for local dev.
 *
 * Identity model: a human player's identity is keyed by their wallet address.
 * Usernames are globally unique (case-insensitive). Returning users prove
 * ownership of the wallet (signature, verified at the API layer) and get a
 * fresh API key issued for their existing agent.
 *
 * Keys: agent:{id} → record | apikey:{hash} → id | wallet:{addr} → id |
 *       uname:{nameLower} → id
 */

import { nanoid } from "nanoid";
import { randomBytes, createHash } from "crypto";
import { Redis } from "@upstash/redis";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const redis = HAS_REDIS ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

const mem = new Map(); // generic key → value for the in-memory fallback

export class RegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function kvGet(key) {
  return HAS_REDIS ? await redis.get(key) : (mem.has(key) ? mem.get(key) : null);
}
async function kvSet(key, value) {
  if (HAS_REDIS) await redis.set(key, value);
  else mem.set(key, value);
}
async function kvDel(key) {
  if (HAS_REDIS) await redis.del(key);
  else mem.delete(key);
}

function hashApiKey(rawKey) {
  return createHash("sha256").update(rawKey).digest("hex");
}
function generateApiKey() {
  return `bf_${randomBytes(24).toString("hex")}`;
}
const unameKey = (name) => `uname:${String(name).trim().toLowerCase()}`;
const walletKey = (addr) => `wallet:${String(addr).toLowerCase()}`;

export async function getAgentById(agentId) {
  if (!agentId) return null;
  return kvGet(`agent:${agentId}`);
}

export async function getAgentByApiKey(rawKey) {
  if (!rawKey) return null;
  const agentId = await kvGet(`apikey:${hashApiKey(rawKey)}`);
  return agentId ? getAgentById(agentId) : null;
}

export async function getAgentByWallet(walletAddress) {
  if (!walletAddress) return null;
  const agentId = await kvGet(walletKey(walletAddress));
  return agentId ? getAgentById(agentId) : null;
}

/** True if `name` is free (or already owned by exceptAgentId). */
export async function isUsernameAvailable(name, exceptAgentId = null) {
  if (!String(name || "").trim()) return false;
  const owner = await kvGet(unameKey(name));
  return !owner || owner === exceptAgentId;
}

/** Issue a fresh API key for an existing agent (sign-in / re-key on a new device). */
export async function issueApiKey(agentId) {
  const rawKey = generateApiKey();
  await kvSet(`apikey:${hashApiKey(rawKey)}`, agentId);
  return rawKey;
}

/**
 * Register a new agent. Wallet-bound (human) registrations claim a globally
 * unique username and a wallet→id mapping. Wallet-less agents (bots) keep the
 * legacy behaviour (no uniqueness index) so reference agents still work.
 */
export async function registerAgent({ agentName, agentType, walletAddress }) {
  const name = String(agentName || "").trim();
  const wallet = walletAddress ? String(walletAddress).toLowerCase() : null;

  if (wallet) {
    if (!name) throw new RegistryError("invalid_username", "A username is required.");
    if (!(await isUsernameAvailable(name))) {
      throw new RegistryError("username_taken", "That username is already taken.");
    }
  }

  const agentId = nanoid();
  const rawKey = generateApiKey();
  const record = {
    agentId,
    agentName: name,
    agentType,
    walletAddress: wallet,
    elo: 1200,
    matchesPlayed: 0,
    createdAt: new Date().toISOString(),
  };

  await kvSet(`agent:${agentId}`, record);
  await kvSet(`apikey:${hashApiKey(rawKey)}`, agentId);
  if (wallet) {
    await kvSet(walletKey(wallet), agentId);
    await kvSet(unameKey(name), agentId);
  }

  return { agentId, apiKey: rawKey, username: name, startingElo: record.elo };
}

/** Change an agent's username (globally unique). Frees the old name. */
export async function changeUsername(agentId, newName) {
  const name = String(newName || "").trim();
  if (!name) throw new RegistryError("invalid_username", "A username is required.");
  if (name.length > 24) throw new RegistryError("invalid_username", "Usernames are at most 24 characters.");

  const agent = await getAgentById(agentId);
  if (!agent) throw new RegistryError("agent_not_found", "Agent not found.");
  if (!(await isUsernameAvailable(name, agentId))) {
    throw new RegistryError("username_taken", "That username is already taken.");
  }

  const oldName = agent.agentName;
  agent.agentName = name;
  await kvSet(`agent:${agentId}`, agent);
  await kvSet(unameKey(name), agentId);
  if (oldName && oldName.trim().toLowerCase() !== name.toLowerCase()) {
    await kvDel(unameKey(oldName));
  }
  return agent;
}

export async function updateAgentStats(agentId, { eloDelta }) {
  const agent = await getAgentById(agentId);
  if (!agent) return null;
  agent.elo += eloDelta;
  agent.matchesPlayed += 1;
  await kvSet(`agent:${agentId}`, agent);
  return agent;
}

export async function listLeaderboard({ limit = 50, agentTypeFilter = "all" } = {}) {
  let agents;
  if (HAS_REDIS) {
    const keys = await redis.keys("agent:*");
    agents = keys.length ? await redis.mget(...keys) : [];
  } else {
    agents = [...mem.entries()].filter(([k]) => k.startsWith("agent:")).map(([, v]) => v);
  }

  const filtered = agentTypeFilter === "all" ? agents : agents.filter((a) => a && a.agentType === agentTypeFilter);

  return filtered
    .filter(Boolean)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit)
    .map((a, i) => ({
      rank: i + 1,
      agentId: a.agentId,
      agentName: a.agentName,
      agentType: a.agentType,
      elo: a.elo,
      matchesPlayed: a.matchesPlayed,
    }));
}
