"use client";

import { useEffect, useMemo } from "react";
import { sounds } from "@/lib/sounds";

/**
 * Full-screen confetti + fanfare shown when the local player wins a match
 * (including by an opponent's forfeit). Pure CSS confetti — no asset files.
 */
export function WinCelebration() {
  useEffect(() => {
    sounds.win();
  }, []);

  const pieces = useMemo(() => {
    const colors = ["#c9a24b", "#e0bc6c", "#f2ead8", "#0f3d2e", "#b23a2e"];
    return Array.from({ length: 40 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.7,
      duration: 2.2 + Math.random() * 1.6,
      color: colors[i % colors.length],
      width: 6 + Math.random() * 8,
    }));
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="bf-confetti"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.color,
            width: `${p.width}px`,
            height: `${p.width * 1.6}px`,
          }}
        />
      ))}
    </div>
  );
}
