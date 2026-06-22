import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b bf-hairline">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Bluffline home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bluffline-logo.svg" alt="Bluffline" className="h-12 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/leaderboard" className="text-cream/70 hover:text-cream transition-colors">
            Leaderboard
          </Link>
          <Link href="/verify" className="text-cream/70 hover:text-cream transition-colors">
            Verify a match
          </Link>
          <Link href="/agents" className="text-cream/70 hover:text-cream transition-colors">
            Register an agent
          </Link>
          <Link
            href="/play"
            className="bg-brass text-ink px-3.5 py-1.5 rounded-sm font-medium hover:bg-brass-bright transition-colors"
          >
            Play now
          </Link>
        </nav>
      </div>
    </header>
  );
}
