"use client";

import { useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ClaimLadder } from "@/components/ClaimLadder";
import { formatClaim } from "@/lib/claims";
import { ActionPanel } from "@/components/ActionPanel";
import { TableSeat } from "@/components/TableSeat";
import { HowToPlay } from "@/components/HowToPlay";
import { InviteLink } from "@/components/InviteLink";
import { SoundToggle } from "@/components/SoundToggle";
import { PreGameCountdown } from "@/components/PreGameCountdown";
import { WinCelebration } from "@/components/WinCelebration";
import { useMatchSocket } from "@/lib/useMatchSocket";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL || "ws://localhost:8080/v1/ws";

export default function TablePage() {
  const params = useParams<{ tableId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const seatIndex = Number(searchParams.get("seat") ?? "0");
  const apiKey = searchParams.get("key") ?? "";
  const mode = searchParams.get("mode");

  const websocketUrl = useMemo(() => {
    if (!params.tableId || !apiKey) return null;
    return `${WS_BASE_URL}?table_id=${params.tableId}&agent_key=${apiKey}`;
  }, [params.tableId, apiKey]);

  const {
    connected,
    seats,
    countdown,
    chips,
    myHand,
    currentClaim,
    isYourTurn,
    timeLimitSeconds,
    lastReveal,
    lastSkip,
    finalStandings,
    forfeit,
    storageContentHash,
    matchId,
    errorMessage,
    sendAction,
    leaveMatch,
  } = useMatchSocket(websocketUrl);

  function handleLeave() {
    if (window.confirm("Leave the table? If a match is in progress you'll forfeit it.")) {
      leaveMatch();
      router.push("/play");
    }
  }

  const nameFor = (idx?: number) =>
    idx === undefined || idx === null
      ? "A player"
      : idx === seatIndex
        ? "You"
        : seats.find((s) => s.seatIndex === idx)?.agentName ?? `Seat ${idx}`;
  const possFor = (idx?: number) => (idx === seatIndex ? "your" : `${nameFor(idx)}’s`);

  if (finalStandings) {
    const youWon = finalStandings.find((s) => s.seatIndex === seatIndex)?.placement === 1;
    return (
      <div className="flex flex-col flex-1">
        <SiteHeader />
        {youWon && <WinCelebration />}
        <section className="felt-surface flex-1 flex items-center justify-center">
          <div className="bf-card-face max-w-lg w-full mx-6 p-8 rounded-md">
            <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
              Match complete
            </p>
            {youWon ? (
              <h1 className="font-display text-3xl text-ink mb-3">🎉 You won!</h1>
            ) : (
              <h1 className="font-display text-2xl text-ink mb-3">Final standings</h1>
            )}
            {forfeit && (
              <p className="text-sm text-ink/70 mb-4">
                {nameFor(forfeit.seatIndex)} {forfeit.reason === "away" ? "was away too long" : "left the table"} — the match was awarded by forfeit.
              </p>
            )}
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
                      #{s.placement} &middot; {nameFor(s.seatIndex)}
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
            <div className="flex items-center gap-4">
              {!connected && <p className="bf-mono text-xs text-brass">Waiting on the game server…</p>}
              <SoundToggle />
              <HowToPlay />
              <button
                type="button"
                onClick={handleLeave}
                className="bf-mono text-xs uppercase tracking-wider text-tell hover:text-tell/80 transition-colors"
              >
                Leave
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-[1fr_220px] gap-8">
            <div>
              {countdown && (
                <PreGameCountdown
                  endsAt={countdown.endsAt}
                  players={seats.filter((s) => !s.isHouse).length}
                  minPlayers={countdown.minPlayers}
                  capacity={countdown.capacity}
                />
              )}

              {/* Seats arranged around the table */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                {!matchId && !countdown && (
                  <div className="col-span-full text-center py-10">
                    <p className="text-cream/40 text-sm">
                      {mode === "human" ? "Waiting for more players to join…" : "Waiting for seats to fill…"}
                    </p>
                    {mode === "human" && <InviteLink tableId={params.tableId} />}
                  </div>
                )}
                {seats.map((seat) => {
                  const isYou = seat.seatIndex === seatIndex;
                  return (
                    <TableSeat
                      key={seat.seatIndex}
                      seat={seat}
                      chips={chips[seat.seatIndex]}
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
                  <p className="font-display text-lg text-cream mb-1">
                    {lastReveal.claimResult === "claim_was_bluff" ? "It was a bluff." : "The claim held."}
                  </p>
                  <p className="text-cream/80 text-sm">
                    {nameFor(lastReveal.callingSeat)} called {possFor(lastReveal.claimantSeat)} bluff on{" "}
                    <span className="bf-mono text-cream">{formatClaim(lastReveal.claim ?? null)}</span>.
                  </p>
                  <p className="text-cream/80 text-sm mt-0.5">
                    {lastReveal.claimResult === "claim_held"
                      ? "The claim was true across the table — the call was wrong."
                      : "The claim wasn’t there — the claimant was bluffing."}
                  </p>
                  <p className="text-sm mt-1">
                    <span className="text-tell">
                      {nameFor(lastReveal.roundLoserSeat)} {lastReveal.roundLoserSeat === seatIndex ? "lose" : "loses"} 100 chips
                    </span>
                    {lastReveal.roundWinnerSeat !== undefined && (
                      <>
                        {" → "}
                        <span className="text-brass-bright">
                          {nameFor(lastReveal.roundWinnerSeat)} {lastReveal.roundWinnerSeat === seatIndex ? "win" : "wins"} 100
                        </span>
                      </>
                    )}
                    .
                  </p>
                </div>
              )}

              {lastSkip && (
                <div
                  className={
                    "border rounded-md p-3 mb-4 text-sm " +
                    (lastSkip.seatIndex === seatIndex && lastSkip.warning
                      ? "border-tell/60 bg-tell/10 text-cream"
                      : "border-cream/15 bg-ink/30 text-cream/80")
                  }
                  role="alert"
                >
                  {lastSkip.seatIndex === seatIndex ? (
                    <>
                      You ran out of time — turn skipped ({lastSkip.consecutiveTimeouts}/{lastSkip.awayAt}).
                      {lastSkip.warning && (
                        <span className="text-tell">
                          {" "}Heads up: your clock is now faster, and you&rsquo;ll be removed from the table after {lastSkip.awayAt} misses in a row.
                        </span>
                      )}
                    </>
                  ) : (
                    <>{nameFor(lastSkip.seatIndex)} ran out of time — their turn was skipped.</>
                  )}
                </div>
              )}

              <ActionPanel
                currentClaim={currentClaim}
                isYourTurn={isYourTurn}
                timeLimitSeconds={timeLimitSeconds}
                errorMessage={errorMessage}
                onSubmitClaim={(claim) => sendAction("claim", claim)}
                onCallBluff={() => sendAction("bluff_call")}
              />
            </div>

            <div className="flex flex-col items-center gap-3">
              <ClaimLadder claim={currentClaim} />
              <p className="bf-mono text-[11px] text-cream/40 text-center">
                Live claim ladder
              </p>
              {currentClaim?.claimantSeat !== undefined && (
                <p className="bf-mono text-[11px] text-cream/60 text-center">
                  Claimed by {nameFor(currentClaim.claimantSeat)}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
