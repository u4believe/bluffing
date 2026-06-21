"use client";

/**
 * src/lib/useIdentity.ts
 * Wallet-bound identity: sign in (prove wallet ownership), load or claim a
 * unique username, and change it. Shared by the lobby and the join page.
 *
 * A cached session is reused only if it belongs to the connected wallet, so
 * switching wallets re-triggers sign-in. New wallets are prompted for a unique
 * username; the same signature is reused for the register call.
 */

import { useState } from "react";
import { login, registerAgent, changeUsername, ApiError, type SignInPayload } from "./api";
import { loadSession, saveSession, type AgentSession } from "./session";
import type { useWallet } from "./useWallet";

type Wallet = ReturnType<typeof useWallet>;

export function useIdentity(wallet: Wallet) {
  const [session, setSession] = useState<AgentSession | null>(() => loadSession());
  const [needsUsername, setNeedsUsername] = useState(false);
  const [pendingSig, setPendingSig] = useState<SignInPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identityReady =
    !!session &&
    !!wallet.address &&
    session.walletAddress?.toLowerCase() === wallet.address.toLowerCase();

  async function startSignIn() {
    setError(null);
    setBusy(true);
    try {
      const sig = await wallet.signIn();
      if (!sig) {
        setError("Signature was rejected — sign in to continue.");
        return;
      }
      const res = await login(sig);
      if (res.exists) {
        const s: AgentSession = {
          agentId: res.agent_id!,
          apiKey: res.api_key!,
          agentName: res.username!,
          elo: res.elo ?? 1200,
          walletAddress: res.wallet_address,
        };
        saveSession(s);
        setSession(s);
        setNeedsUsername(false);
      } else {
        setPendingSig(sig);
        setNeedsUsername(true);
      }
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function claimUsername(name: string) {
    const username = name.trim();
    if (!username || !pendingSig) return;
    setError(null);
    setBusy(true);
    try {
      const res = await registerAgent({
        agentName: username,
        agentType: "human",
        walletAddress: pendingSig.address,
        signIn: pendingSig,
      });
      const s: AgentSession = {
        agentId: res.agent_id,
        apiKey: res.api_key,
        agentName: res.username,
        elo: res.starting_elo,
        walletAddress: pendingSig.address,
      };
      saveSession(s);
      setSession(s);
      setNeedsUsername(false);
      setPendingSig(null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "username_taken"
          ? "That username is taken — try another."
          : "Couldn't claim that username."
      );
    } finally {
      setBusy(false);
    }
  }

  async function rename(name: string): Promise<boolean> {
    const username = name.trim();
    if (!username || !session) return false;
    setError(null);
    try {
      const res = await changeUsername(session.apiKey, username);
      const s = { ...session, agentName: res.username };
      saveSession(s);
      setSession(s);
      return true;
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "username_taken"
          ? "That username is taken."
          : "Couldn't change username."
      );
      return false;
    }
  }

  return {
    session,
    setSession,
    identityReady,
    needsUsername,
    busy,
    error,
    setError,
    startSignIn,
    claimUsername,
    rename,
  };
}
