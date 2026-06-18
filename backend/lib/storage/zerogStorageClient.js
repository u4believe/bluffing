/**
 * lib/storage/zerogStorageClient.js
 *
 * Wrapper around 0G Storage (@0gfoundation/0g-storage-ts-sdk). The rest of the
 * codebase depends only on this stable interface — uploadJSON / fetchJSON /
 * computeContentHash — never the SDK directly.
 *
 * Live vs mock:
 *   - Live 0G Storage when ZEROG_STORAGE_LIVE=1 (or NODE_ENV=production) AND the
 *     creds are present; otherwise an in-memory mock so local dev/tests never
 *     touch the network.
 *   - Live content identifier is the 0G Storage Merkle root hash (what gets
 *     pinned on-chain and used to fetch). Mock uses a sha256 of the payload.
 *     computeContentHash() re-derives the right one per mode so verify works
 *     against either backend.
 *
 * Small JSON blobs are uploaded in-memory via MemData (no temp files), and
 * fetched back in-memory via downloadToBlob with Merkle-proof verification.
 */

import { hashMatchLog } from "./commitReveal.js";

const INDEXER_RPC =
  process.env.ZEROG_STORAGE_INDEXER_RPC ||
  process.env.ZEROG_STORAGE_RPC_URL ||
  "https://indexer-storage-testnet-turbo.0g.ai";
const EVM_RPC = process.env.ZEROG_CHAIN_RPC_URL;
const STORAGE_PRIVATE_KEY = process.env.ZEROG_STORAGE_PRIVATE_KEY;

const FORCE_LIVE = process.env.ZEROG_STORAGE_LIVE === "1";
const HAS_CREDS = !!(INDEXER_RPC && EVM_RPC && STORAGE_PRIVATE_KEY);
const USE_MOCK = !HAS_CREDS || (!FORCE_LIVE && process.env.NODE_ENV !== "production");

// In-memory mock store for local dev when not running against live 0G Storage.
const mockStore = new Map();

/**
 * Deterministic serialization shared by upload and content-hash recompute, so
 * a fetched-and-reparsed log re-hashes to the exact value it was stored under.
 */
function serialize(payload) {
  return JSON.stringify(payload);
}

// Lazily constructed live SDK singletons (only when actually talking to 0G).
let _live = null;
async function live() {
  if (!_live) {
    const sdk = await import("@0gfoundation/0g-storage-ts-sdk");
    const { ethers } = await import("ethers");
    const indexer = new sdk.Indexer(INDEXER_RPC);
    const signer = new ethers.Wallet(STORAGE_PRIVATE_KEY, new ethers.JsonRpcProvider(EVM_RPC));
    _live = { sdk, indexer, signer };
  }
  return _live;
}

async function merkleRoot(bytes) {
  const { sdk } = await live();
  const [tree, err] = await new sdk.MemData(bytes).merkleTree();
  if (err) throw new Error(`0G Storage merkle tree failed: ${err}`);
  return tree.rootHash();
}

/**
 * Upload a JSON-serializable object to 0G Storage.
 * Returns { contentHash, storageUri, txHash }.
 */
export async function uploadJSON(payload) {
  if (USE_MOCK) {
    const contentHash = hashMatchLog(payload);
    mockStore.set(contentHash, payload);
    return { contentHash, storageUri: `mock://0g-storage/${contentHash}`, txHash: null };
  }

  const { sdk, indexer, signer } = await live();
  const bytes = new TextEncoder().encode(serialize(payload));
  const file = new sdk.MemData(bytes);

  const [tree, treeErr] = await file.merkleTree();
  if (treeErr) throw new Error(`0G Storage merkle tree failed: ${treeErr}`);

  const [tx, upErr] = await indexer.upload(file, EVM_RPC, signer);
  if (upErr) throw new Error(`0G Storage upload failed: ${upErr}`);

  const rootHash = tree.rootHash();
  return { contentHash: rootHash, storageUri: `0g://${rootHash}`, txHash: tx?.txHash || null };
}

/**
 * Fetch a previously uploaded JSON object from 0G Storage by content hash
 * (Merkle root in live mode). Live downloads verify the Merkle proof.
 */
export async function fetchJSON(contentHash) {
  if (USE_MOCK) {
    const value = mockStore.get(contentHash);
    if (!value) throw new Error(`mock_storage_miss: no object found for hash ${contentHash}`);
    return value;
  }

  const { indexer } = await live();
  const [blob, err] = await indexer.downloadToBlob(contentHash, { proof: true });
  if (err) throw new Error(`0G Storage download failed: ${err}`);
  const text = Buffer.from(await blob.arrayBuffer()).toString("utf8");
  return JSON.parse(text);
}

/**
 * Re-derive the content hash for a payload using the active backend's scheme,
 * so verify can independently recompute what was pinned on-chain.
 *   mock → sha256 (hashMatchLog); live → 0G Storage Merkle root.
 */
export async function computeContentHash(payload) {
  if (USE_MOCK) return hashMatchLog(payload);
  return merkleRoot(new TextEncoder().encode(serialize(payload)));
}

export function isLiveStorage() {
  return !USE_MOCK;
}
