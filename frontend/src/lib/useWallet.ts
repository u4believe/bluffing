"use client";

/**
 * src/lib/useWallet.ts
 * Minimal EIP-1193 wallet connection (MetaMask et al.) with no extra deps.
 * Players must connect a wallet on the 0G Galileo testnet before taking a seat;
 * the connected address is linked to their agent so matches settle under their
 * real on-chain identity instead of a placeholder.
 */

import { useCallback, useEffect, useState } from "react";

/** 0G Galileo testnet — chain 16602 (0x40da). */
export const ZEROG_TESTNET = {
  chainIdHex: "0x40da",
  chainName: "0G-Galileo-Testnet",
  rpcUrls: ["https://evmrpc-testnet.0g.ai"],
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  blockExplorerUrls: ["https://chainscan-galileo.0g.ai"],
};

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function getProvider(): Eip1193Provider | undefined {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

const isCorrect = (chainId: string | null) =>
  !!chainId && chainId.toLowerCase() === ZEROG_TESTNET.chainIdHex;

export interface WalletState {
  hasProvider: boolean;
  address: string | null;
  chainId: string | null;
  onCorrectChain: boolean;
  connecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    hasProvider: false,
    address: null,
    chainId: null,
    onCorrectChain: false,
    connecting: false,
    error: null,
  });

  // Detect an already-authorized account + track account/chain changes.
  useEffect(() => {
    const eth = getProvider();
    if (!eth) return;
    setState((s) => ({ ...s, hasProvider: true }));

    let active = true;
    (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        const chainId = (await eth.request({ method: "eth_chainId" })) as string;
        if (!active) return;
        setState((s) => ({
          ...s,
          address: accounts[0] ?? null,
          chainId,
          onCorrectChain: isCorrect(chainId),
        }));
      } catch {
        /* not yet authorized — fine */
      }
    })();

    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      setState((s) => ({ ...s, address: accounts[0] ?? null }));
    };
    const onChain = (...args: unknown[]) => {
      const chainId = args[0] as string;
      setState((s) => ({ ...s, chainId, onCorrectChain: isCorrect(chainId) }));
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      active = false;
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  /** Switch the wallet to 0G testnet, adding the network if it isn't there yet. */
  const ensureChain = useCallback(async (eth: Eip1193Provider) => {
    const current = (await eth.request({ method: "eth_chainId" })) as string;
    if (isCorrect(current)) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ZEROG_TESTNET.chainIdHex }],
      });
    } catch (err) {
      const e = err as { code?: number; message?: string };
      // 4902 = chain unknown to the wallet → add it (which also selects it).
      if (e?.code === 4902 || /Unrecognized chain|not been added/i.test(e?.message ?? "")) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ZEROG_TESTNET.chainIdHex,
              chainName: ZEROG_TESTNET.chainName,
              rpcUrls: ZEROG_TESTNET.rpcUrls,
              nativeCurrency: ZEROG_TESTNET.nativeCurrency,
              blockExplorerUrls: ZEROG_TESTNET.blockExplorerUrls,
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  /** Prompt connection + ensure 0G testnet. Returns the address or null. */
  const connect = useCallback(async (): Promise<string | null> => {
    const eth = getProvider();
    if (!eth) {
      setState((s) => ({ ...s, error: "No wallet detected. Install MetaMask to connect." }));
      return null;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      await ensureChain(eth);
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      const address = accounts[0] ?? null;
      setState((s) => ({
        ...s,
        address,
        chainId,
        onCorrectChain: isCorrect(chainId),
        connecting: false,
      }));
      return isCorrect(chainId) ? address : null;
    } catch (err) {
      const e = err as { code?: number; message?: string };
      const msg = e?.code === 4001 ? "Connection rejected." : e?.message || "Failed to connect wallet.";
      setState((s) => ({ ...s, connecting: false, error: msg }));
      return null;
    }
  }, [ensureChain]);

  // Sign the canonical sign-in message to prove wallet ownership. Returns the
  // payload the API verifies, or null if rejected. Must match the backend's
  // signInMessage() byte-for-byte.
  const signIn = useCallback(async (): Promise<{ address: string; issued_at: string; signature: string } | null> => {
    const eth = getProvider();
    if (!eth || !state.address) return null;
    const issuedAt = new Date().toISOString();
    const message = `Bluffline sign-in\nAddress: ${state.address}\nIssued: ${issuedAt}`;
    try {
      const signature = (await eth.request({ method: "personal_sign", params: [message, state.address] })) as string;
      return { address: state.address, issued_at: issuedAt, signature };
    } catch {
      return null;
    }
  }, [state.address]);

  return { ...state, connect, signIn };
}
