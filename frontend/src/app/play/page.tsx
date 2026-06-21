"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { registerAgent, findTable, leaveCurrentTable, listOpenTables, ApiError } from "@/lib/api";
import { loadSession, saveSession, type AgentSession } from "@/lib/session";
import type { OpenTable } from "@/lib/types";
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
  const [tableIdInput, setTableIdInput] = useState("");
  const [minPlayers, setMinPlayers] = useState(2);
  const [blocked, setBlocked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [openTables, setOpenTables] = useState<OpenTable[]>([]);
  const wallet = useWallet();

  // Poll the lobby for open human tables anyone can join.
  useEffect(() => {
    let active = true;
    const refresh = () => listOpenTables().then((r) => active && setOpenTables(r.tables)).catch(() => {});
    refresh();
    const id = setInterval(refresh, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const walletReady = !!wallet.address && wallet.onCorrectChain;

  function handleJoinById() {
    const id = tableIdInput.trim();
    if (id) router.push(`/join/${encodeURIComponent(id)}`);
  }

  async function handleLeaveCurrent() {
    if (!session) return;
    setLeaving(true);
    try {
      await leaveCurrentTable(session.apiKey);
      setBlocked(false);
      setErrorMessage(null);
    } catch {
      setErrorMessage("Couldn't leave your current table — try again.");
    } finally {
      setLeaving(false);
    }
  }

  async function handleSitDown(mode: "dealer" | "human") {
    setErrorMessage(null);
    setBlocked(false);
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
        includeHouseAgent: mode === "dealer",
        minPlayers: mode === "human" ? minPlayers : 2,
      });
      router.push(`/play/${table.table_id}?seat=${table.seat_index}&key=${activeSession.apiKey}&mode=${mode}`);
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.code === "already_in_a_table") {
        setBlocked(true);
        setErrorMessage("You're already seated at a table — leave it before joining another.");
      } else {
        setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong finding a table.");
      }
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
            <p className="text-tell text-sm mb-2" role="alert">
              {errorMessage}
            </p>
          )}
          {blocked && session && (
            <button
              type="button"
              onClick={handleLeaveCurrent}
              disabled={leaving}
              className="w-full mb-4 border border-tell/50 bg-tell/10 text-ink rounded-sm px-3 py-2.5 text-sm font-medium hover:border-tell transition-colors disabled:opacity-50"
            >
              {leaving ? "Leaving…" : "Leave that table"}
            </button>
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
              <div className="flex items-center justify-between gap-2 mt-1">
                <label className="bf-mono text-[11px] text-slate-on-cream">
                  Players to wait for
                </label>
                <select
                  value={minPlayers}
                  onChange={(e) => setMinPlayers(Number(e.target.value))}
                  className="border bf-hairline-cream rounded-sm px-2 py-1.5 bg-cream-dim text-ink text-sm focus:outline-none"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} players
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => handleSitDown("human")}
                disabled={!walletReady}
                className="w-full border border-felt/40 text-ink font-medium py-3 rounded-sm hover:border-felt hover:bg-felt/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Play others <span className="text-ink/50 font-normal">&middot; wait for {minPlayers}, then a 60s countdown</span>
              </button>
            </div>
          )}
          {!walletReady && (
            <p className="bf-mono text-[11px] text-slate-on-cream text-center mt-2">
              Connect a wallet to play.
            </p>
          )}

          {/* Join a specific table by its ID (e.g. shared without the full link) */}
          <div className="mt-6 pt-5 border-t bf-hairline-cream">
            <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
              Have a table ID?
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={tableIdInput}
                onChange={(e) => setTableIdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinById()}
                placeholder="Paste a table ID"
                className="flex-1 border bf-hairline-cream rounded-sm px-3 py-2.5 bg-cream-dim text-ink placeholder:text-ink/30 focus:outline-none bf-mono text-sm"
              />
              <button
                type="button"
                onClick={handleJoinById}
                disabled={!tableIdInput.trim()}
                className="px-4 bg-felt text-cream font-medium rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Join
              </button>
            </div>
          </div>

          {/* Open tables anyone can join (no invite/ID needed) */}
          <div className="mt-6 pt-5 border-t bf-hairline-cream">
            <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2 block">
              Open tables{openTables.length > 0 ? ` (${openTables.length})` : ""}
            </span>
            {openTables.length === 0 ? (
              <p className="text-ink/45 text-sm">No open tables right now — start one with “Play others”.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                {openTables.map((t) => (
                  <li
                    key={t.table_id}
                    className="flex items-center justify-between border bf-hairline-cream rounded-sm px-3 py-2"
                  >
                    <span className="text-ink/80 text-sm">
                      <span className="bf-mono">{t.table_id.slice(0, 8)}</span>
                      <span className="text-ink/50">
                        {" "}&middot; {t.players}/{t.min_players}
                        {t.phase === "countdown" ? " · starting soon" : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => router.push(`/join/${t.table_id}`)}
                      className="bf-mono text-[11px] uppercase tracking-wider text-brass hover:text-brass-bright transition-colors"
                    >
                      Join
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
