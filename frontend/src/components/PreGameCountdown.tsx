"use client";

import { useEffect, useState } from "react";
import { sounds } from "@/lib/sounds";

/** Pre-game countdown banner shown once a table meets its minimum players. */
export function PreGameCountdown({
  endsAt,
  players,
  minPlayers,
  capacity,
}: {
  endsAt: number;
  players: number;
  minPlayers: number;
  capacity: number;
}) {
  const remaining = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const [left, setLeft] = useState(remaining);

  useEffect(() => {
    const id = setInterval(() => setLeft(remaining()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  // Play a distinct "get ready" fanfare 5s before the game starts.
  useEffect(() => {
    const delay = endsAt - 5000 - Date.now();
    if (delay <= 0) return;
    const id = setTimeout(() => sounds.gameStarting(), delay);
    return () => clearTimeout(id);
  }, [endsAt]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="border border-brass/40 bg-brass/10 rounded-md p-4 mb-6 text-center">
      <p className="bf-mono text-[11px] uppercase tracking-wider text-cream/60">Game starts in</p>
      <p className="font-display text-4xl text-brass-bright tabular-nums my-1">
        {mm}:{ss}
      </p>
      <p className="bf-mono text-[11px] text-cream/60">
        {players} player{players !== 1 ? "s" : ""} seated &middot; need {minPlayers}, up to {capacity}
      </p>
    </div>
  );
}
