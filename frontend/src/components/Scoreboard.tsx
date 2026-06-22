"use client";

import type { Seat } from "@/lib/types";
import clsx from "clsx";

/**
 * Live chip standings for everyone at the table, sorted richest-first.
 * Chips update as rounds settle (see hand_revealed in useMatchSocket).
 */
export function Scoreboard({
  seats,
  chips,
  seatIndex,
  nameFor,
}: {
  seats: Seat[];
  chips: Record<number, number>;
  seatIndex: number;
  nameFor: (idx?: number) => string;
}) {
  const rows = seats
    .filter((s) => typeof chips[s.seatIndex] === "number")
    .map((s) => ({ seatIndex: s.seatIndex, chips: chips[s.seatIndex] }))
    .sort((a, b) => b.chips - a.chips);

  if (rows.length === 0) return null;

  return (
    <div className="w-full bf-card-face rounded-md p-3">
      <p className="bf-mono text-[10px] uppercase tracking-wider text-slate-on-cream mb-2">
        Chip standings
      </p>
      <ol className="flex flex-col gap-1.5">
        {rows.map((row, i) => {
          const isYou = row.seatIndex === seatIndex;
          const isLeader = i === 0;
          return (
            <li
              key={row.seatIndex}
              className={clsx(
                "flex items-center justify-between text-sm rounded-sm px-2 py-1",
                isYou ? "bg-brass/15" : "bg-transparent"
              )}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="bf-mono text-[11px] text-ink/40 w-3 shrink-0">{i + 1}</span>
                <span className="text-ink truncate">
                  {nameFor(row.seatIndex)}
                  {isLeader && <span className="text-brass"> 👑</span>}
                </span>
              </span>
              <span className="bf-mono text-[11px] text-ink/70 shrink-0">
                {row.chips.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
