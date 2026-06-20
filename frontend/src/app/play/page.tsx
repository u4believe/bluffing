"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { registerAgent, findTable, ApiError } from "@/lib/api";
import { loadSession, saveSession, type AgentSession } from "@/lib/session";
import { useWallet } from "@/lib/useWallet";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function PlayLobbyPage() {
  const router = useRouter();
  const [session, setSession] = useState<AgentSession | null>(() => loadSession());
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"idle" | "registering" | "finding" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wallet = useWallet();

  const walletReady = !!wallet.address && wallet.onCorrectChain;

  async function handleSitDown(mode: "dealer" | "human") {
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

      setStatus("finding");
      // Dealer mode fills the empty seat with The Dealer for an instant match;
      // human mode holds the table open until another player joins.
      const table = await findTable(activeSession.apiKey, {
        preferredSeatCount: 2,
        includeHouseAgent: mode === "dealer",
      });
      router.push(`/play/${table.table_id}?seat=${table.seat_index}&key=${activeSession.apiKey}&mode=${mode}`);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong finding a table.");
    }
  }

  const isBusy = status === "registering" || status === "finding";

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <section className="felt-surface flex-1 flex items-center justify-center">
        <div className="bf-card-face max-w-md w-full mx-6 p-8 rounded-md">
          <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
            Quick match
          </p>
          <h1 className="font-display text-3xl text-ink mb-3">Take a seat</h1>
          <p className="text-ink/65 text-sm leading-relaxed mb-6">
            {session
              ? `You're playing as ${session.agentName} (ELO ${session.elo}). Connect your wallet, and we'll seat you with another player or The Dealer.`
              : "Connect a wallet on 0G testnet, pick a name, and we'll seat you with another player — or The Dealer if no one's waiting."}
          </p>

          {/* Step 1 — wallet gate. Seats require a 0G-testnet wallet. */}
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

          {/* Step 2 — name (only when there's no saved identity yet) */}
          {!session && (
            <label className="block mb-5">
              <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
                2 &middot; Display name
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Temitope"
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

          {/* Step 3 — choose an opponent */}
          <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
            3 &middot; Opponent
          </span>
          {isBusy ? (
            <div className="w-full bg-felt/80 text-cream font-medium py-3 rounded-sm text-center">
              {status === "registering" ? "Registering you at the table…" : "Finding a seat…"}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleSitDown("dealer")}
                disabled={!walletReady}
                className="w-full bg-felt text-cream font-medium py-3 rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Play The Dealer <span className="text-cream/60 font-normal">&middot; instant</span>
              </button>
              <button
                type="button"
                onClick={() => handleSitDown("human")}
                disabled={!walletReady}
                className="w-full border border-felt/40 text-ink font-medium py-3 rounded-sm hover:border-felt hover:bg-felt/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Play others <span className="text-ink/50 font-normal">&middot; wait for others</span>
              </button>
            </div>
          )}
          {!walletReady && (
            <p className="bf-mono text-[11px] text-slate-on-cream text-center mt-2">
              Connect a wallet to play.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
