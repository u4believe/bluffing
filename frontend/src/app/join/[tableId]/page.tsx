"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { joinTable, leaveCurrentTable, ApiError } from "@/lib/api";
import { useWallet } from "@/lib/useWallet";
import { useIdentity } from "@/lib/useIdentity";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function JoinTablePage() {
  const router = useRouter();
  const params = useParams<{ tableId: string }>();
  const tableId = params.tableId;

  const wallet = useWallet();
  const identity = useIdentity(wallet);
  const { session, identityReady, needsUsername, busy: idBusy } = identity;

  const [status, setStatus] = useState<"idle" | "joining" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const walletReady = !!wallet.address && wallet.onCorrectChain;

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

  async function handleJoin() {
    setErrorMessage(null);
    setBlocked(false);
    if (!identityReady || !session) {
      setErrorMessage("Sign in with your wallet first.");
      return;
    }
    setStatus("joining");
    try {
      const table = await joinTable(session.apiKey, tableId);
      router.push(`/play/${table.table_id}?seat=${table.seat_index}&key=${session.apiKey}&mode=human`);
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.code === "already_in_a_table") {
        setBlocked(true);
        setErrorMessage("You're already seated at a table — leave it before joining another.");
      } else {
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
  }

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
            Table {tableId?.slice(0, 8)}. Connect your wallet on 0G testnet and sign in to take the open seat.
          </p>

          {/* Step 1 — wallet */}
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

          {/* Step 2 — identity */}
          {walletReady && (
            <div className="mb-5">
              <span className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-1.5 block">
                2 &middot; Identity
              </span>
              {identityReady && session ? (
                <div className="flex items-center justify-between border border-felt/30 bg-felt/5 rounded-sm px-3 py-2.5">
                  <span className="text-ink text-sm">
                    Joining as <strong>{session.agentName}</strong>
                  </span>
                  <span className="bf-mono text-[11px] text-felt">✓ signed in</span>
                </div>
              ) : needsUsername ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && identity.claimUsername(usernameInput)}
                    placeholder="Choose a username"
                    maxLength={24}
                    className="flex-1 border bf-hairline-cream rounded-sm px-3 py-2.5 bg-cream-dim text-ink placeholder:text-ink/30 focus:outline-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => identity.claimUsername(usernameInput)}
                    disabled={idBusy || !usernameInput.trim()}
                    className="px-4 bg-felt text-cream font-medium rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  >
                    Claim
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={identity.startSignIn}
                  disabled={idBusy}
                  className="w-full bg-ink text-cream rounded-sm px-3 py-2.5 text-sm font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
                >
                  {idBusy ? "Check your wallet…" : "Sign in with wallet"}
                </button>
              )}
              {identity.error && (
                <p className="text-tell text-xs mt-1.5" role="alert">
                  {identity.error}
                </p>
              )}
            </div>
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

          <button
            type="button"
            onClick={handleJoin}
            disabled={status === "joining" || !identityReady}
            className="w-full bg-felt text-cream font-medium py-3 rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "joining" ? "Joining the table…" : identityReady ? "Join table" : "Sign in to join"}
          </button>
        </div>
      </section>
    </div>
  );
}
