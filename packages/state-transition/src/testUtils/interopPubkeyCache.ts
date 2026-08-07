import fs from "node:fs";
import path from "node:path";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {interopSecretKey} from "../util/interop.js";
import {testCachePath} from "./cache.js";

/**
 * This util persists the generated keys as PKIX snapshots in the local test-cache dir, so
 * they are generated once per machine and reloaded for tests.
 *
 * Snapshots are named `interop-pubkeys-<count>.pkix` where `<count>` is the exact number
 * of entries.
 *
 * Larger requests extend from the largest snapshot available and persist a new snapshot.
 * since 1) keys are index-ordered and 2) the native cache is append-only.
 */

/** Below this count, generating keys is faster than snapshot bookkeeping (~80ms) */
const MIN_PERSIST_SIZE = 1000;
/**
 * Loading a snapshot allocates its full native capacity (~144B/entry), so only load one
 * bigger than requested when the keygen it saves is substantial (~80us/key).
 */
const MIN_OVERSIZED_LOAD_SIZE = 100_000;

const SNAPSHOT_REGEX = /^interop-pubkeys-(\d+)\.pkix$/;

function snapshotPath(count: number): string {
  return path.join(testCachePath, `interop-pubkeys-${count}.pkix`);
}

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

/** Counts of all persisted snapshots, largest first */
function snapshotCounts(): number[] {
  if (!fs.existsSync(testCachePath)) return [];
  return fs
    .readdirSync(testCachePath)
    .map((file) => SNAPSHOT_REGEX.exec(file)?.[1])
    .filter((count): count is string => count !== undefined)
    .map(Number)
    .sort((a, b) => b - a);
}

/**
 * Candidate snapshots for a request of `vc` keys: all snapshots not exceeding vc
 * (largest first), else the smallest bigger one when the request is large enough
 * that loading extra entries beats regenerating.
 */
function snapshotCandidates(vc: number): number[] {
  const counts = snapshotCounts();
  const candidates = counts.filter((count) => count <= vc);
  const smallest = counts.at(-1);
  if (candidates.length === 0 && vc >= MIN_OVERSIZED_LOAD_SIZE && smallest !== undefined) {
    candidates.push(smallest);
  }
  return candidates;
}

/** How many of the keys [0, vc) the best candidate snapshot provides */
function snapshotCoverage(vc: number): number {
  const candidates = snapshotCandidates(vc);
  return candidates.length === 0 ? 0 : Math.min(candidates[0], vc);
}

/** Load the snapshot that best covers `vc` into the (empty) cache, if one exists */
function loadBestSnapshot(vc: number): void {
  for (const count of snapshotCandidates(vc)) {
    const filepath = snapshotPath(count);
    try {
      pubkeyCache.load(filepath, count);
      return;
    } catch {
      // Stale ABI, corrupt or torn file: drop it so future runs regenerate it
      fs.rmSync(filepath, {force: true});
    }
  }
}

function saveSnapshot(count: number): void {
  fs.mkdirSync(testCachePath, {recursive: true});
  // Write-then-rename so concurrent test processes never observe a partial file
  const tmpPath = `${snapshotPath(count)}.tmp-${process.pid}`;
  try {
    pubkeyCache.save(tmpPath);
    fs.renameSync(tmpPath, snapshotPath(count));
  } catch {
    fs.rmSync(tmpPath, {force: true});
  }
}

/**
 * Ensure the process-wide pubkey cache holds the interop pubkeys for indices [0, vc),
 * loading persisted snapshots and generating as few keys as possible. No-op if the cache
 * already holds them.
 */
export function ensureInteropPubkeyCache(vc: number): void {
  if (vc <= 0 || hasInteropPrefix(vc)) return;

  // The cache is append-only, so when it already holds a shorter interop prefix it can
  // be extended in place — but only if no snapshot covers more of [0, vc) than it does
  const size = pubkeyCache.size;
  const sizeToExtend = size > 0 && size < vc && hasInteropPrefix(size) ? size : 0;
  const holdsOtherKeys = size > 0 && sizeToExtend === 0;
  if (holdsOtherKeys || sizeToExtend < snapshotCoverage(vc)) {
    pubkeyCache.reset();
    loadBestSnapshot(vc);
  }

  const loadedSize = pubkeyCache.size;
  if (loadedSize >= vc) return;

  for (let i = loadedSize; i < vc; i++) {
    pubkeyCache.append(i, interopSecretKey(i).toPublicKey().toBytes());
  }

  if (vc >= MIN_PERSIST_SIZE && !fs.existsSync(snapshotPath(vc))) {
    saveSnapshot(vc);
  }
}
