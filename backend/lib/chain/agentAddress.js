/**
 * lib/chain/agentAddress.js
 *
 * Maps a Bluffline agent to a 0G Chain address for settlement.
 *
 * Agents that linked a real wallet at registration settle under it. Everyone
 * else — humans who didn't connect a wallet, and the house agent — gets a
 * deterministic placeholder address derived from their agentId, so their
 * on-chain ELO identity is still stable and consistent across matches.
 */

import { ethers } from "ethers";

export function agentIdToAddress(agentId, walletAddress) {
  if (walletAddress && ethers.isAddress(walletAddress)) {
    return ethers.getAddress(walletAddress);
  }
  // keccak256 over a namespaced agentId → take the low 20 bytes → checksum.
  const hash = ethers.keccak256(ethers.toUtf8Bytes(`bluffline:agent:${agentId}`));
  return ethers.getAddress("0x" + hash.slice(-40));
}
