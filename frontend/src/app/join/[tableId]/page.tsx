"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { registerAgent, joinTable, ApiError } from "@/lib/api";
import { loadSession, saveSession, type AgentSession } from "@/lib/session";
import { useWallet } from "@/lib/useWallet";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function JoinTablePage() {
  const router = useRouter();
  const params = useParams<{ tableId: string }>();
  const tableId = params.tableId;

  const [session, setSession] = useState<AgentSession | null>(() => loadSession());
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"idle" | "registering" | "joining" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wallet = useWallet();

  const walletReady = !!wallet.address && wallet.onCorrectChain;

  async function handleJoin() {
    setErrorMessage(null);
    if (!walletReady) {
      setErrorMessage("Connect a wallet on 0G testnet first.");
      return;
    }
    try {
      let activeSession = session;
      if (!activeSession) {
        setStatus("registering");
        const name = displayName.trim() || `Player ${Math.floor(Math.random() * 9000 + 1000)}`;
        const result = await registerAgent({
          agentName: name,
          agentType: "human",
          walletAddress: wallet.address ?? undefined,
        });
        activeSession = {
          agentId: result.agent_id,
          apiKey: result.api_key,
          agentName: name,
          elo: result.starting_elo,
          walletAddress: wallet.address ?? undefined,
        };
        saveSession(activeSession);
        setSession(activeSession);
      }

      setStatus("joining");
      const table = await joinTable(activeSession.apiKey, tableId);
      router.push(`/play/${table.table_id}?seat=${table.seat_index}&key=${activeSession.apiKey}&mode=human`);
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof ApiError
          ? err.code === "table_full"
            ? "That table is already full."
            : err.code === "match_already_started"
              ? "That match has already started."
              : err.code === "table_not_found"
                ? "That table is no longer available."
                : err.message
          : "Could not join that table."
      );
    }
  }

  const isBusy = status === "registering" || status === "joining";

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <section className="felt-surface flex-1 flex items-center justify-center">
        <div className="bf-card-face max-w-md w-full mx-6 p-8 rounded-md">
          <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
            You&rsquo;ve been invited
          </p>
          <h1 className="font-display text-3xl text-ink mb-3">Join the table</h1>
          <p className="text-ink/65 text-sm leading-relaxed mb-6">
            Table {tableId?.slice(0, 8)}. Connect your wallet on 0G testnet
            {session ? ` — you'll join as ${session.agentName}.` : " and pick a name to take the open seat."}
          </p>

          {/* Wallet gate */}
          <div className="mb-5">
            <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
              1 &middot; Wallet
            </span>
            {!wallet.hasProvider ? (
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center border bf-hairline-cream rounded-sm px-3 py-2.5 text-ink/70 hover:border-ink/40 transition-colors text-sm"
              >
                No wallet detected — install MetaMask &rarr;
              </a>
            ) : walletReady ? (
              <div className="flex items-center justify-between border border-felt/30 bg-felt/5 rounded-sm px-3 py-2.5">
                <span className="bf-mono text-sm text-ink">{short(wallet.address!)}</span>
                <span className="bf-mono text-[11px] text-felt">✓ 0G testnet</span>
              </div>
            ) : wallet.address && !wallet.onCorrectChain ? (
              <button
                type="button"
                onClick={() => wallet.connect()}
                disabled={wallet.connecting}
                className="w-full border border-tell/50 bg-tell/10 text-ink rounded-sm px-3 py-2.5 text-sm hover:border-tell transition-colors disabled:opacity-50"
              >
                Wrong network — switch to 0G testnet
              </button>
            ) : (
              <button
                type="button"
                onClick={() => wallet.connect()}
                disabled={wallet.connecting}
                className="w-full bg-ink text-cream rounded-sm px-3 py-2.5 text-sm font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
              >
                {wallet.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
            {wallet.error && (
              <p className="text-tell text-xs mt-1.5" role="alert">
                {wallet.error}
              </p>
            )}
          </div>

          {!session && (
            <label className="block mb-5">
              <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
                2 &middot; Display name
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Ola"
                maxLength={24}
                className="w-full border bf-hairline-cream rounded-sm px-3 py-2.5 bg-cream-dim text-ink placeholder:text-ink/30 focus:outline-none"
              />
            </label>
          )}

          {errorMessage && (
            <p className="text-tell text-sm mb-4" role="alert">
              {errorMessage}
            </p>
          )}

          <button
            type="button"
            onClick={handleJoin}
            disabled={isBusy || !walletReady}
            className="w-full bg-felt text-cream font-medium py-3 rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "registering" && "Registering you…"}
            {status === "joining" && "Joining the table…"}
            {(status === "idle" || status === "error") && (walletReady ? "Join table" : "Connect wallet to join")}
          </button>
        </div>
      </section>
    </div>
  );
}
