"use client";

import { useEffect, useState } from "react";
import { CLAIM_LADDER, CLAIM_LABELS, formatClaim } from "@/lib/claims";
import type { Claim, ClaimType } from "@/lib/types";
import clsx from "clsx";

export function ActionPanel({
  currentClaim,
  isYourTurn,
  errorMessage,
  onSubmitClaim,
  onCallBluff,
}: {
  currentClaim: Claim | null;
  isYourTurn: boolean;
  errorMessage?: string | null;
  onSubmitClaim: (claim: Claim) => void;
  onCallBluff: () => void;
}) {
  const currentTypeIndex = currentClaim ? CLAIM_LADDER.indexOf(currentClaim.claim_type) : -1;
  // Can't drop below the standing claim's type.
  const minTypeIndex = currentClaim ? currentTypeIndex : 0;

  // Minimum rank that strictly outranks the standing claim for a given type:
  // a higher claim_type wins at any rank; the same type must beat the rank.
  function minRankFor(type: ClaimType): number {
    if (!currentClaim) return 1;
    const typeIndex = CLAIM_LADDER.indexOf(type);
    if (typeIndex > currentTypeIndex) return 1;
    return currentClaim.rank_threshold + 1;
  }

  const [claimType, setClaimType] = useState<ClaimType>(currentClaim?.claim_type ?? "high_card");
  const [rankThreshold, setRankThreshold] = useState<number>(minRankFor(currentClaim?.claim_type ?? "high_card"));

  // Reset the form to a valid default whenever the standing claim changes
  // (e.g. an opponent raised), so the selection can never be a stale invalid one.
  useEffect(() => {
    const defaultType = currentClaim?.claim_type ?? "high_card";
    setClaimType(defaultType);
    setRankThreshold(minRankFor(defaultType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClaim?.claim_type, currentClaim?.rank_threshold]);

  if (!isYourTurn) {
    return (
      <div className="flex items-center justify-center py-6 text-slate text-sm">
        Waiting for the table&rsquo;s move&hellip;
      </div>
    );
  }

  const minRank = minRankFor(claimType);
  const canRaiseThisType = minRank <= 9; // same type already at rank 9 → must go higher type
  const effectiveRank = Math.min(9, Math.max(rankThreshold, minRank));

  return (
    <div className="flex flex-col gap-4 bf-card-face p-4 rounded-md">
      <div>
        <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
          Standing claim
        </p>
        <p className="font-display text-base text-ink">{formatClaim(currentClaim)}</p>
      </div>

      <div className="h-px bf-hairline-cream" />

      <div>
        <p className="bf-mono text-[11px] uppercase tracking-wider text-slate-on-cream mb-2">
          Raise the claim
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {CLAIM_LADDER.map((type, i) => {
            const disabled = i < minTypeIndex;
            return (
              <button
                key={type}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setClaimType(type);
                  setRankThreshold(minRankFor(type));
                }}
                className={clsx(
                  "px-2.5 py-1.5 rounded-sm text-xs font-medium border transition-colors",
                  claimType === type
                    ? "bg-felt text-cream border-felt"
                    : "border-ink/15 text-ink/70 hover:border-ink/40",
                  disabled && "opacity-30 cursor-not-allowed"
                )}
              >
                {CLAIM_LABELS[type]}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-3 text-sm text-ink/80">
          Rank threshold
          <input
            type="range"
            min={canRaiseThisType ? minRank : 1}
            max={9}
            value={effectiveRank}
            disabled={!canRaiseThisType}
            onChange={(e) => setRankThreshold(Number(e.target.value))}
            className="flex-1 accent-[var(--bf-felt)] disabled:opacity-40"
          />
          <span className="bf-mono w-6 text-right">{effectiveRank}</span>
        </label>
        {!canRaiseThisType && (
          <p className="bf-mono text-[11px] text-slate-on-cream mt-1.5">
            Already at the top rank — pick a higher claim type, or call bluff.
          </p>
        )}
      </div>

      {errorMessage && (
        <p className="text-tell text-xs" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={!canRaiseThisType}
          onClick={() => onSubmitClaim({ claim_type: claimType, rank_threshold: effectiveRank })}
          className="flex-1 bg-felt text-cream font-medium text-sm py-2.5 rounded-sm hover:bg-felt-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Raise claim
        </button>
        <button
          type="button"
          disabled={!currentClaim}
          onClick={onCallBluff}
          className={clsx(
            "flex-1 font-medium text-sm py-2.5 rounded-sm transition-colors border",
            currentClaim
              ? "bg-tell text-cream border-tell hover:bg-tell/85"
              : "border-ink/15 text-ink/30 cursor-not-allowed"
          )}
        >
          Call bluff
        </button>
      </div>
    </div>
  );
}
