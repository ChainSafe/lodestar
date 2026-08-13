import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ensureInteropPubkeyCache, testCachePath} from "../../../src/testUtils/index.js";
import {interopSecretKey} from "../../../src/util/interop.js";

// Counts used only by this test file, so cleanup cannot remove snapshots of real size
const VC_SMALL = 1024;
const VC_LARGE = 2048;

const snapshotSmall = path.join(testCachePath, `interop-pubkeys-${VC_SMALL}.pkix`);
const snapshotLarge = path.join(testCachePath, `interop-pubkeys-${VC_LARGE}.pkix`);

function rmSnapshots(): void {
  fs.rmSync(snapshotSmall, {force: true});
  fs.rmSync(snapshotLarge, {force: true});
}

function expectInteropKeyAt(index: number): void {
  const expected = interopSecretKey(index).toPublicKey().toBytes();
  expect(Buffer.from(pubkeyCache.getOrThrow(index).toBytes())).toEqual(Buffer.from(expected));
}

describe("ensureInteropPubkeyCache", () => {
  beforeEach(() => {
    rmSnapshots();
    pubkeyCache.reset();
  });

  afterAll(() => {
    rmSnapshots();
    pubkeyCache.reset();
  });

  it("generates interop keys and persists a snapshot", () => {
    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(0);
    expectInteropKeyAt(VC_SMALL - 1);
    expect(fs.existsSync(snapshotSmall)).toBe(true);
  });

  it("is a no-op when the cache already holds the keys", () => {
    ensureInteropPubkeyCache(VC_SMALL);
    const mtimeMs = fs.statSync(snapshotSmall).mtimeMs;

    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expect(fs.statSync(snapshotSmall).mtimeMs).toBe(mtimeMs);
  });

  it("reloads from the snapshot after a reset without re-persisting", () => {
    ensureInteropPubkeyCache(VC_SMALL);
    const mtimeMs = fs.statSync(snapshotSmall).mtimeMs;
    pubkeyCache.reset();

    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);
    expect(fs.statSync(snapshotSmall).mtimeMs).toBe(mtimeMs);
  });

  it("extends a shorter interop prefix in place and persists the larger snapshot", () => {
    ensureInteropPubkeyCache(VC_SMALL);

    ensureInteropPubkeyCache(VC_LARGE);

    expect(pubkeyCache.size).toBe(VC_LARGE);
    expectInteropKeyAt(VC_LARGE - 1);
    expect(fs.existsSync(snapshotLarge)).toBe(true);
  });

  it("serves a smaller request from a cache holding more keys without touching it", () => {
    ensureInteropPubkeyCache(VC_LARGE);

    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_LARGE);
    expectInteropKeyAt(VC_SMALL - 1);
  });

  it("recovers the interop mapping after the cache was replaced by other keys", () => {
    ensureInteropPubkeyCache(VC_SMALL);
    pubkeyCache.reset();
    // Simulate a fixture registering non-interop keys (e.g. from a real network state)
    pubkeyCache.append(0, interopSecretKey(999_999).toPublicKey().toBytes());

    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(0);
    expectInteropKeyAt(VC_SMALL - 1);
  });

  it("regenerates and replaces a corrupt snapshot", () => {
    ensureInteropPubkeyCache(VC_SMALL);
    pubkeyCache.reset();
    fs.writeFileSync(snapshotSmall, Buffer.from("not a pkix file"));

    ensureInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);

    // The replacement snapshot must be loadable
    pubkeyCache.reset();
    ensureInteropPubkeyCache(VC_SMALL);
    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);
  });
});
