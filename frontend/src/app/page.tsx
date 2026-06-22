import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ClaimLadder } from "@/components/ClaimLadder";

export default function HomePage() {
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />

      {/* Hero: the felt table at the moment of a claim, with the ladder as proof */}
      <section className="felt-surface flex-1 flex items-center">
        <div className="max-w-5xl mx-auto px-6 py-20 grid md:grid-cols-[1.3fr_1fr] gap-12 items-center w-full">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bluffline-logo.svg" alt="Bluffline" className="h-24 w-auto mb-6" />
            <p className="bf-mono text-xs uppercase tracking-[0.18em] text-brass mb-4">
              Zero Cup 2026 &middot; Built on 0G
            </p>
            <h1 className="font-display text-5xl md:text-6xl leading-[1.05] text-cream mb-6">
              Humans and agents.
              <br />
              <span className="italic text-brass-bright">Same table.</span>
            </h1>
            <p className="text-cream/70 text-lg max-w-md mb-8 leading-relaxed">
              Bluffline is a bluffing card game where you never know if you&rsquo;re
              sitting across from a person or an AI &mdash; until the hand is revealed.
              Every claim, every call, every reveal is logged to 0G Storage and
              settled on 0G Chain, so you don&rsquo;t have to take anyone&rsquo;s word for it.
            </p>
            <div className="flex items-center gap-4">
              <Link
                href="/play"
                className="bg-brass text-ink px-6 py-3 rounded-sm font-medium hover:bg-brass-bright transition-colors"
              >
                Sit at a table
              </Link>
              <Link
                href="/verify"
                className="text-cream/80 px-2 py-3 font-medium hover:text-cream transition-colors underline decoration-cream/30 underline-offset-4"
              >
                Verify a past match &rarr;
              </Link>
            </div>
          </div>

          {/* Signature element: the claim ladder, mid-escalation */}
          <div className="flex flex-col items-center gap-3">
            <ClaimLadder claim={{ claim_type: "straight_run", rank_threshold: 6 }} />
            <p className="bf-mono text-[11px] text-cream/40 text-center max-w-[200px]">
              The claim ladder &mdash; every raise has to outrank the last
            </p>
          </div>
        </div>
      </section>

      {/* How it works — three short, concrete steps, no filler */}
      <section className="bg-ink border-t bf-hairline">
        <div className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-10">
          <Step
            title="Claim, raise, or call"
            body="Each round, the table builds an ascending claim about the hands in play. Raise it, or call bluff and force a reveal."
          />
          <Step
            title="Nobody's labeled"
            body="Seats don't say who's human and who's an agent. You find out who you were playing after the hand ends."
          />
          <Step
            title="Every hand is provable"
            body="Hands are committed to 0G Storage before they're dealt, and every result is settled on 0G Chain. Anyone can verify a match wasn't rigged."
          />
        </div>
      </section>

      <footer className="border-t bf-hairline">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-xs text-cream/40">
          <span>Bluffline &middot; Zero Cup submission</span>
          <span className="bf-mono">0G Storage &middot; 0G Chain</span>
        </div>
      </footer>
    </div>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-display text-lg text-cream mb-2">{title}</h3>
      <p className="text-cream/60 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
