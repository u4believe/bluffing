"use client";

/**
 * src/lib/sounds.ts
 * Tiny synthesized sound effects via the Web Audio API — no asset files.
 * Each game move/event gets a short distinct tone. Respects a persisted mute.
 */

const MUTE_KEY = "bluffline:muted";

let ctx: AudioContext | null = null;
let muted = false;

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(MUTE_KEY) === "1";
}

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers start the context suspended until a user gesture; resume() is a
  // no-op if already running and succeeds once the user has interacted.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = "sine", gain = 0.07, delayMs = 0) {
  if (muted) return;
  const c = audioCtx();
  if (!c) return;
  const start = c.currentTime + delayMs / 1000;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000);
}

export const sounds = {
  deal: () => tone(330, 70, "triangle", 0.05),
  claim: () => tone(494, 90, "triangle"),
  yourTurn: () => tone(660, 130, "sine", 0.06),
  bluff: () => {
    tone(320, 180, "sawtooth", 0.06);
    tone(240, 220, "sawtooth", 0.05, 60);
  },
  reveal: () => {
    tone(392, 120, "sine");
    tone(523, 200, "sine", 0.07, 110);
  },
  matchEnd: () => {
    tone(523, 130, "triangle", 0.07);
    tone(659, 130, "triangle", 0.07, 120);
    tone(784, 240, "triangle", 0.07, 240);
  },
  // Distinct rising fanfare ~5s before a countdown ends — "get ready".
  gameStarting: () => {
    tone(523, 140, "square", 0.05);
    tone(659, 140, "square", 0.05, 150);
    tone(784, 140, "square", 0.05, 300);
    tone(1047, 320, "square", 0.06, 450);
  },
  // Triumphant flourish for a win.
  win: () => {
    tone(659, 140, "triangle", 0.08);
    tone(784, 140, "triangle", 0.08, 140);
    tone(988, 140, "triangle", 0.08, 280);
    tone(1319, 460, "triangle", 0.09, 420);
  },
};

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  }
}
