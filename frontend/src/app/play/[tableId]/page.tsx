"use client";

import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ClaimLadder } from "@/components/ClaimLadder";
import { ActionPanel } from "@/components/ActionPanel";
import { TableSeat } from "@/components/TableSeat";
import { useMatchSocket } from "@/lib/useMatchSocket";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL || "ws://localhost:8080/v1/ws";

export default function TablePage() {
  const params = useParams<{ tableId: string }>();
  const searchParams = useSearchParams();
  const seatIndex = Number(searchParams.get("seat") ?? "0");
  const apiKey = searchParams.get("key") ?? "";

  const websocketUrl = useMemo(() => {
    if (!params.tableId || !apiKey) return null;
    return `${WS_BASE_URL}?table_id=${params.tableId}&agent_key=${apiKey}`;
  }, [params.tableId, apiKey]);

  const {
    connected,
    seats,
    myHand,
    currentClaim,
    isYourTurn,
    lastReveal,
    finalStandings,
    storageContentHash,
    matchId,
    sendAction,
  } = useMatchSocket(websocketUrl);

  if (finalStandings) {
    return (
      <div className="flex flex-col flex-1">
        <SiteHeader />
        <section className="felt-surface flex-1 flex items-center justify-center">
          <div className="bf-card-face max-w-lg w-full mx-6 p-8 rounded-md">
            <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
              Match complete
            </p>
            <h1 className="font-display text-2xl text-ink mb-5">Final standings</h1>
            <ol className="flex flex-col gap-2 mb-6">
              {finalStandings
                .slice()
                .sort((a, b) => a.placement - b.placement)
                .map((s) => (
                  <li
                    key={s.seatIndex}
                    className="flex items-center justify-between border-b bf-hairline-cream pb-2 text-sm"
                  >
                    <span className="text-ink">
                      #{s.placement} &middot; Seat {s.seatIndex}
                    </span>
                    <span className="bf-mono text-ink/60">{s.finalChips} chips</span>
                  </li>
                ))}
            </ol>
            {matchId && (
              <Link
                href={`/verify/${matchId}`}
                className="block text-center bg-felt text-cream font-medium py-3 rounded-sm hover:bg-felt-dark transition-colors"
              >
                Verify this match &rarr;
              </Link>
            )}
            {storageContentHash && (
              <p className="bf-mono text-[11px] text-slate-on-cream text-center mt-3 break-all">
                {storageContentHash}
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <section className="felt-surface flex-1 px-6 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <p className="bf-mono text-xs text-cream/50">
              Table {params.tableId?.slice(0, 8)} &middot; {connected ? "connected" : "connecting…"}
            </p>
            {!connected && <p className="bf-mono text-xs text-brass">Waiting on the game server…</p>}
          </div>

          <div className="grid md:grid-cols-[1fr_220px] gap-8">
            <div>
              {/* Seats arranged around the table */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                {seats.length === 0 && (
                  <p className="text-cream/40 text-sm col-span-full text-center py-10">
                    Waiting for seats to fill&hellip;
                  </p>
                )}
                {seats.map((seat) => {
                  const isYou = seat.seatIndex === seatIndex;
                  return (
                    <TableSeat
                      key={seat.seatIndex}
                      seat={seat}
                      // Your own hand is visible all hand long; others only at a showdown.
                      hand={isYou ? myHand ?? undefined : lastReveal?.hands[seat.seatIndex]}
                      isCurrentTurn={isYourTurn && isYou}
                      isYou={isYou}
                      revealed={!!lastReveal}
                      isLoser={lastReveal?.roundLoserSeat === seat.seatIndex}
                    />
                  );
                })}
              </div>

              {lastReveal && (
                <div
                  className={
                    "border rounded-md p-4 mb-6 " +
                    (lastReveal.claimResult === "claim_was_bluff"
                      ? "border-tell/50 bg-tell/10"
                      : "border-brass/50 bg-brass/10")
                  }
                >
                  <p className="font-display text-lg text-cream">
                    {lastReveal.claimResult === "claim_was_bluff" ? "It was a bluff." : "The claim held."}
                  </p>
                </div>
              )}

              <ActionPanel
                currentClaim={currentClaim}
                isYourTurn={isYourTurn}
                onSubmitClaim={(claim) => sendAction("claim", claim)}
                onCallBluff={() => sendAction("bluff_call")}
              />
            </div>

            <div className="flex flex-col items-center gap-3">
              <ClaimLadder claim={currentClaim} />
              <p className="bf-mono text-[11px] text-cream/40 text-center">
                Live claim ladder
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
