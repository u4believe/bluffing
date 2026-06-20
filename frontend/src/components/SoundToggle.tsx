"use client";

import { useEffect, useState } from "react";
import { isMuted, setMuted } from "@/lib/sounds";

/** Small mute/unmute toggle for the move sounds, persisted in localStorage. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const [muted, setMutedState] = useState(false);

  // Sync from storage after mount (avoids SSR/CSR hydration mismatch).
  useEffect(() => {
    setMutedState(isMuted());
  }, []);

  function toggle() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      className={"bf-mono text-xs uppercase tracking-wider text-cream/50 hover:text-cream transition-colors " + className}
    >
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
