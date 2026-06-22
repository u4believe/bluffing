"use client";

import Link from "next/link";
import type { MatchStanding } from "@/lib/types";

/**
 * Settlement modal: overlays the final table and announces the winner,
 * the full chip standings, and a link to verify the match on-chain.
 */
export function ResultModal({
  finalStandings,
  seatIndex,
  nameFor,
  forfeit,
  matchId,
  storageContentHash,
  onDismiss,
}: {
  finalStandings: MatchStanding[];
  seatIndex: number;
  nameFor: (idx?: number) => string;
  forfeit: { seatIndex: number; reason: string } | null;
  matchId: string | null;
  storageContentHash: string | null;
  onDismiss: () => void;
}) {
  const sorted = finalStandings.slice().sort((a, b) => a.placement - b.placement);
  const winner = sorted.find((s) => s.placement === 1);
  const youWon = winner?.seatIndex === seatIndex;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Match results"
    >
      <div className="bf-card-face relative max-w-lg w-full p-8 rounded-md shadow-2xl">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-4 bf-mono text-lg text-ink/40 hover:text-ink transition-colors"
        >
          ×
        </button>

        <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
          Match complete
        </p>

        {youWon ? (
          <h1 className="font-display text-3xl text-ink mb-1">🎉 You won!</h1>
        ) : (
          <h1 className="font-display text-2xl text-ink mb-1">
            {nameFor(winner?.seatIndex)} wins
          </h1>
        )}
        <p className="text-sm text-ink/60 mb-4">
          {youWon
            ? "You finished with the most chips at the table."
            : "Better luck next hand — here’s how the table finished."}
        </p>

        {forfeit && (
          <p className="text-sm text-ink/70 mb-4">
            {nameFor(forfeit.seatIndex)}{" "}
            {forfeit.reason === "away" ? "was away too long" : "left the table"} — the match was
            awarded by forfeit.
          </p>
        )}

        <ol className="flex flex-col gap-2 mb-6">
          {sorted.map((s) => (
            <li
              key={s.seatIndex}
              className="flex items-center justify-between border-b bf-hairline-cream pb-2 text-sm"
            >
              <span className={s.seatIndex === seatIndex ? "text-ink font-medium" : "text-ink"}>
                #{s.placement} &middot; {nameFor(s.seatIndex)}
              </span>
              <span className="bf-mono text-ink/60">{s.finalChips.toLocaleString()} chips</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          {matchId && (
            <Link
              href={`/verify/${matchId}`}
              className="block text-center bg-felt text-cream font-medium py-3 rounded-sm hover:bg-felt-dark transition-colors"
            >
              Verify this match &rarr;
            </Link>
          )}
          <Link
            href="/play"
            className="block text-center border bf-hairline-cream text-ink/80 font-medium py-2.5 rounded-sm hover:bg-ink/5 transition-colors"
          >
            Back to lobby
          </Link>
        </div>

        {storageContentHash && (
          <p className="bf-mono text-[11px] text-slate-on-cream text-center mt-3 break-all">
            {storageContentHash}
          </p>
        )}
      </div>
    </div>
  );
}
