"use client";

import { useState } from "react";

/** Shareable invite link shown while a human waits for an opponent. */
export function InviteLink({ tableId }: { tableId: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/join/${tableId}` : `/join/${tableId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the link is still selectable */
    }
  }

  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <p className="bf-mono text-[11px] uppercase tracking-wider text-cream/40">Invite a friend to this table</p>
      <div className="flex items-center gap-2 max-w-full">
        <code className="bf-mono text-[11px] text-cream/70 bg-ink/40 px-2.5 py-1.5 rounded truncate max-w-[260px]">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="bf-mono text-[11px] uppercase tracking-wider text-brass hover:text-brass-bright transition-colors whitespace-nowrap"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
