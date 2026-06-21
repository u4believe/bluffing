/**
 * lib/walletAuth.js
 *
 * Verifies that a sign-in request was signed by the wallet it claims, proving
 * ownership before we load/re-key that wallet's identity. Stateless: the signed
 * message embeds the address + an issued-at timestamp, and we reject anything
 * older than a few minutes to bound replay.
 */

import { ethers } from "ethers";

const MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

/** The exact message the client signs. Must match on both sides byte-for-byte. */
export function signInMessage(address, issuedAt) {
  return `Bluffline sign-in\nAddress: ${address}\nIssued: ${issuedAt}`;
}

/**
 * Verify { address, issuedAt, signature }. Returns { ok, address? , reason? }.
 */
export function verifySignIn({ address, issuedAt, signature }) {
  if (!address || !issuedAt || !signature) return { ok: false, reason: "missing_fields" };

  const ts = Date.parse(issuedAt);
  if (Number.isNaN(ts)) return { ok: false, reason: "bad_timestamp" };
  const now = Date.now();
  if (now - ts > MAX_AGE_MS || ts - now > CLOCK_SKEW_MS) return { ok: false, reason: "stale_signature" };

  let recovered;
  try {
    recovered = ethers.verifyMessage(signInMessage(address, issuedAt), signature);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (recovered.toLowerCase() !== String(address).toLowerCase()) {
    return { ok: false, reason: "address_mismatch" };
  }
  return { ok: true, address: recovered.toLowerCase() };
}
