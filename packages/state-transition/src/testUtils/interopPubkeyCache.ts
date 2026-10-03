import fs from "node:fs";
import path from "node:path";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {interopSecretKey} from "../util/interop.js";
import {testCachePath} from "./cache.js";

/**
 * This util persists generated keys as a PKIX snapshot in the local test-cache dir, so
 * they are generated once per machine and reloaded for tests.
 *
 * The snapshot grows to satisfy larger requests. Smaller requests may load more entries
 * than they need since cache contents do not define validator-registry membership.
 */

/** Below this count, generating keys is faster than snapshot bookkeeping (~80ms) */
const MIN_PERSIST_SIZE = 1000;
const MAX_SNAPSHOT_CAPACITY = 0xffffffff;
const defaultSnapshotPath = path.join(testCachePath, "interop-pubkeys.pkix");

/** Sentinel pubkeys used to verify cache contents, memoized as they are re-checked often */
const interopPubkeyByIndex = new Map<number, Uint8Array>();

function interopPubkey(index: number): Uint8Array {
  let pubkey = interopPubkeyByIndex.get(index);
  if (!pubkey) {
    pubkey = interopSecretKey(index).toPublicKey().toBytes();
    interopPubkeyByIndex.set(index, pubkey);
  }
  return pubkey;
}

function isInteropKeyAt(index: number): boolean {
  const pubkey = pubkeyCache.get(index);
  return pubkey !== undefined && Buffer.compare(pubkey.toBytes(), interopPubkey(index)) === 0;
}

/**
 * True if cache entries [0, count) are the index-matching interop pubkeys. Checking the
 * two endpoints suffices: the native cache is append-only and never remaps an index, so
 * replacing any entry in between would have required a reset() clearing index 0 too.
 */
function hasInteropPrefix(count: number): boolean {
  return pubkeyCache.size >= count && isInteropKeyAt(0) && isInteropKeyAt(count - 1);
}

function loadSnapshot(snapshotPath: string): void {
  if (!fs.existsSync(snapshotPath)) return;

  try {
    pubkeyCache.load(snapshotPath, MAX_SNAPSHOT_CAPACITY);
  } catch {
    // Stale ABI, corrupt or torn file: drop it so future runs regenerate it
    fs.rmSync(snapshotPath, {force: true});
  }
}

function saveSnapshot(snapshotPath: string): void {
  fs.mkdirSync(path.dirname(snapshotPath), {recursive: true});
  // Write-then-rename so concurrent test processes never observe a partial file
  const tmpPath = `${snapshotPath}.tmp-${process.pid}`;
  try {
    pubkeyCache.save(tmpPath);
    fs.renameSync(tmpPath, snapshotPath);
  } catch {
    fs.rmSync(tmpPath, {force: true});
  }
}

/**
 * Ensure the process-wide pubkey cache holds the interop pubkeys for indices [0, vc),
 * loading persisted snapshots and generating as few keys as possible. No-op if the cache
 * already holds them.
 */
export function ensureInteropPubkeyCache(vc: number, snapshotPath = defaultSnapshotPath): void {
  if (vc <= 0 || hasInteropPrefix(vc)) return;

  // The cache is append-only, so extend a shorter interop prefix in place. Otherwise,
  // replace unrelated contents with the persisted interop cache when available.
  const size = pubkeyCache.size;
  const sizeToExtend = size > 0 && size < vc && hasInteropPrefix(size) ? size : 0;
  if (sizeToExtend === 0) {
    pubkeyCache.reset();
    loadSnapshot(snapshotPath);
  }

  let loadedSize = pubkeyCache.size;
  if (loadedSize > 0 && !hasInteropPrefix(loadedSize)) {
    pubkeyCache.reset();
    loadedSize = 0;
  }
  if (loadedSize >= vc) return;

  for (let i = loadedSize; i < vc; i++) {
    pubkeyCache.append(i, interopSecretKey(i).toPublicKey().toBytes());
  }

  if (vc >= MIN_PERSIST_SIZE) {
    saveSnapshot(snapshotPath);
  }
}
