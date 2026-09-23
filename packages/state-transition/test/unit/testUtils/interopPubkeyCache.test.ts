import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ensureInteropPubkeyCache, testCachePath} from "../../../src/testUtils/index.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const VC_SMALL = 1024;
const VC_LARGE = 2048;

const snapshotPath = path.join(testCachePath, `interop-pubkeys.test-${process.pid}.pkix`);

function ensureTestInteropPubkeyCache(vc: number): void {
  ensureInteropPubkeyCache(vc, snapshotPath);
}

function rmSnapshot(): void {
  fs.rmSync(snapshotPath, {force: true});
}

function expectInteropKeyAt(index: number): void {
  const expected = interopSecretKey(index).toPublicKey().toBytes();
  expect(Buffer.from(pubkeyCache.getPubkeyBytesOrThrow(index))).toEqual(Buffer.from(expected));
}

describe("ensureInteropPubkeyCache", () => {
  beforeEach(() => {
    rmSnapshot();
    pubkeyCache.reset();
  });

  afterAll(() => {
    rmSnapshot();
    pubkeyCache.reset();
  });

  it("generates interop keys and persists a snapshot", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(0);
    expectInteropKeyAt(VC_SMALL - 1);
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it("is a no-op when the cache already holds the keys", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);
    const mtimeMs = fs.statSync(snapshotPath).mtimeMs;

    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expect(fs.statSync(snapshotPath).mtimeMs).toBe(mtimeMs);
  });

  it("reloads from the snapshot after a reset without re-persisting", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);
    const mtimeMs = fs.statSync(snapshotPath).mtimeMs;
    pubkeyCache.reset();

    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);
    expect(fs.statSync(snapshotPath).mtimeMs).toBe(mtimeMs);
  });

  it("extends a shorter interop prefix and replaces the snapshot", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);
    const smallSnapshotSize = fs.statSync(snapshotPath).size;

    ensureTestInteropPubkeyCache(VC_LARGE);

    expect(pubkeyCache.size).toBe(VC_LARGE);
    expectInteropKeyAt(VC_LARGE - 1);
    expect(fs.statSync(snapshotPath).size).toBeGreaterThan(smallSnapshotSize);
  });

  it("loads a larger snapshot for a smaller request", () => {
    ensureTestInteropPubkeyCache(VC_LARGE);
    pubkeyCache.reset();

    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_LARGE);
    expectInteropKeyAt(VC_SMALL - 1);
  });

  it("recovers the interop mapping after the cache was replaced by other keys", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);
    pubkeyCache.reset();
    // Simulate a fixture registering non-interop keys (e.g. from a real network state)
    pubkeyCache.append(0, interopSecretKey(999_999).toPublicKey().toBytes());

    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(0);
    expectInteropKeyAt(VC_SMALL - 1);
  });

  it("regenerates and replaces a corrupt snapshot", () => {
    ensureTestInteropPubkeyCache(VC_SMALL);
    pubkeyCache.reset();
    fs.writeFileSync(snapshotPath, Buffer.from("not a pkix file"));

    ensureTestInteropPubkeyCache(VC_SMALL);

    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);

    // The replacement snapshot must be loadable
    pubkeyCache.reset();
    ensureTestInteropPubkeyCache(VC_SMALL);
    expect(pubkeyCache.size).toBe(VC_SMALL);
    expectInteropKeyAt(VC_SMALL - 1);
  });
});
