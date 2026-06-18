/**
 * lib/chain/zerogChainClient.js
 *
 * Thin wrapper around ethers.js for talking to the BlufflineSettlement
 * contract on 0G Chain. Isolated here so route handlers never touch
 * ethers/contract details directly.
 */

import { ethers } from "ethers";

const RPC_URL = process.env.ZEROG_CHAIN_RPC_URL;
const CONTRACT_ADDRESS = process.env.ZEROG_SETTLEMENT_CONTRACT_ADDRESS;
const SETTLER_PRIVATE_KEY = process.env.ZEROG_SETTLER_PRIVATE_KEY;

// Settle on real 0G Chain when explicitly enabled (ZEROG_CHAIN_LIVE=1) or in
// production — but only if all creds are present; otherwise fall back to the
// in-memory mock so local dev/tests never touch the network. Deliberately
// decoupled from 0G Storage: chain settlement only needs the content hash
// (computed locally), so we can settle on-chain before the Storage SDK upload
// is wired in.
const FORCE_LIVE = process.env.ZEROG_CHAIN_LIVE === "1";
const HAS_CREDS = !!(RPC_URL && CONTRACT_ADDRESS && SETTLER_PRIVATE_KEY);
const USE_MOCK = !HAS_CREDS || (!FORCE_LIVE && process.env.NODE_ENV !== "production");

const ABI = [
  "function recordMatch(string matchId, string storageContentHash, address[] participants, int32[] eloDeltas, uint8[] placements) external",
  "function getMatchResult(string matchId) external view returns (tuple(string matchId, string storageContentHash, address[] participants, int32[] eloDeltas, uint8[] placements, uint256 timestamp, bool recorded))",
  "function getElo(address participant) external view returns (int32)",
  "event MatchSettled(string matchId, string storageContentHash, address[] participants, int32[] eloDeltas, uint256 timestamp)",
];

// In-memory mock chain state for local dev without a deployed contract.
const mockChainState = {
  matches: new Map(),
  elo: new Map(),
};

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getSettlerWallet() {
  const provider = getProvider();
  return new ethers.Wallet(SETTLER_PRIVATE_KEY, provider);
}

function getContract(signerOrProvider) {
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

/**
 * Settle a completed match on-chain.
 * participants: array of wallet addresses (or deterministic placeholder addresses for agents without wallets)
 * eloDeltas: array of signed integers, same order as participants
 * placements: array of 1-indexed final placements, same order as participants
 *
 * Returns { txHash }
 */
export async function recordMatchOnChain({ matchId, storageContentHash, participants, eloDeltas, placements }) {
  if (USE_MOCK) {
    mockChainState.matches.set(matchId, {
      matchId,
      storageContentHash,
      participants,
      eloDeltas,
      placements,
      timestamp: Date.now(),
    });
    participants.forEach((addr, i) => {
      const current = mockChainState.elo.get(addr) ?? 1200;
      mockChainState.elo.set(addr, current + eloDeltas[i]);
    });
    return { txHash: `mock-tx-${matchId}` };
  }

  const wallet = getSettlerWallet();
  const contract = getContract(wallet);
  const tx = await contract.recordMatch(matchId, storageContentHash, participants, eloDeltas, placements);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Fetch a settled match result from-chain. */
export async function getMatchResultFromChain(matchId) {
  if (USE_MOCK) {
    const result = mockChainState.matches.get(matchId);
    if (!result) throw new Error(`mock_chain_miss: no match found for ${matchId}`);
    return result;
  }

  const provider = getProvider();
  const contract = getContract(provider);
  return await contract.getMatchResult(matchId);
}

/** Fetch a participant's current ELO from-chain. */
export async function getEloFromChain(address) {
  if (USE_MOCK) {
    return mockChainState.elo.get(address) ?? 1200;
  }

  const provider = getProvider();
  const contract = getContract(provider);
  const elo = await contract.getElo(address);
  return Number(elo);
}
