import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {SecretKey, aggregatePublicKeys} from "../src/blst.js";
import {pubkeyCache} from "../src/pubkeys.js";

// Generate deterministic valid BLS keypairs for testing
const keypairs = Array.from({length: 3}, (_, i) => {
  const ikm = new Uint8Array(32);
  ikm[0] = i + 1;
  const sk = SecretKey.fromKeygen(ikm);
  const pk = sk.toPublicKey();
  return {index: i, pubkeyBytes: pk.toBytes()};
});

const canEnforceDirectoryPermissions = typeof process.getuid === "function" && process.getuid() !== 0;

function seedCache(count = keypairs.length): void {
  pubkeyCache.reset();
  pubkeyCache.ensureCapacity(2_000);
  for (const {index, pubkeyBytes} of keypairs.slice(0, count)) {
    pubkeyCache.append(index, pubkeyBytes);
  }
}

function expectCacheContents(count = keypairs.length): void {
  expect(pubkeyCache.size).toBe(count);
  for (const {index, pubkeyBytes} of keypairs.slice(0, count)) {
    expect(pubkeyCache.getIndex(pubkeyBytes)).toBe(index);
    expect(pubkeyCache.getOrThrow(index).toBytes()).toEqual(pubkeyBytes);
  }
  expect(pubkeyCache.get(count)).toBeUndefined();
}

describe("pubkeys", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-z-pubkeys-"));
  const tempPkixPath = path.join(tempDir, "cache.pkix");

  beforeEach(() => {
    seedCache();
  });

  afterAll(() => {
    fs.rmSync(tempDir, {force: true, recursive: true});
  });

  it("append populates both directions and updates size", () => {
    pubkeyCache.reset();
    for (const {index, pubkeyBytes} of keypairs) {
      pubkeyCache.append(index, pubkeyBytes);
    }
    expect(pubkeyCache.size).toBe(keypairs.length);

    for (const {index, pubkeyBytes} of keypairs) {
      expect(pubkeyCache.get(index)).toBeDefined();
      expect(pubkeyCache.getIndex(pubkeyBytes)).toBe(index);
    }
  });

  it("syncPubkeys incrementally populates both lookup directions", () => {
    pubkeyCache.reset();
    const validators = keypairs.map(({pubkeyBytes}) => ({pubkey: pubkeyBytes}));

    pubkeyCache.syncPubkeys(validators.slice(0, 1));
    pubkeyCache.syncPubkeys(validators);

    expectCacheContents();
  });

  it("syncPubkeys accepts a historical validator list", () => {
    const validators = keypairs.map(({pubkeyBytes}) => ({pubkey: pubkeyBytes}));

    pubkeyCache.syncPubkeys(validators.slice(0, 1));

    expectCacheContents();
  });

  it("syncPubkeys rejects an invalid suffix without publishing valid entries", () => {
    pubkeyCache.reset();
    const validators = [{pubkey: keypairs[0].pubkeyBytes}, {pubkey: new Uint8Array(48)}];

    expect(() => pubkeyCache.syncPubkeys(validators)).toThrow();
    expect(pubkeyCache.size).toBe(0);
    expect(pubkeyCache.getIndex(keypairs[0].pubkeyBytes)).toBeNull();
  });

  it("get returns fresh deserialized values without memoizing wrappers", () => {
    const pk1 = pubkeyCache.getOrThrow(0);
    const pk2 = pubkeyCache.getOrThrow(0);
    expect(pk1).not.toBe(pk2);
    expect(pk1.toBytes()).toEqual(keypairs[0].pubkeyBytes);
    expect(pk2.toBytes()).toEqual(keypairs[0].pubkeyBytes);
  });

  it("aggregates cached pubkeys by index", () => {
    const indices = [0, 1, 2];
    const expected = aggregatePublicKeys(indices.map((index) => pubkeyCache.getOrThrow(index)));
    expect(pubkeyCache.aggregate(indices).toBytes()).toEqual(expected.toBytes());
  });

  it("returns the cached pubkey for a single-key aggregate", () => {
    expect(pubkeyCache.aggregate([1]).toBytes()).toEqual(pubkeyCache.getOrThrow(1).toBytes());
  });

  it("get returns undefined for out-of-range index", () => {
    expect(pubkeyCache.get(0xffffffff)).toBeUndefined();
  });

  it("rejects indices that are not exact uint32 values", () => {
    for (const index of [-1, 0.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pubkeyCache.get(index)).toThrow("InvalidUnsignedInteger");
      expect(() => pubkeyCache.getPubkeyBytes(index)).toThrow("InvalidUnsignedInteger");
      expect(() => pubkeyCache.aggregate([0, index])).toThrow("InvalidUnsignedInteger");
      expect(() => pubkeyCache.append(index, keypairs[0].pubkeyBytes)).toThrow("InvalidUnsignedInteger");
      expect(() => pubkeyCache.ensureCapacity(index)).toThrow("InvalidUnsignedInteger");
      expect(() => pubkeyCache.load(tempPkixPath, index)).toThrow("InvalidUnsignedInteger");
    }
  });

  it("getPubkeyBytes returns the compressed pubkey bytes", () => {
    for (const {index, pubkeyBytes} of keypairs) {
      expect(pubkeyCache.getPubkeyBytes(index)).toEqual(pubkeyBytes);
    }
  });

  it("getPubkeyBytes matches getOrThrow().toBytes() and returns copies", () => {
    const bytes = pubkeyCache.getPubkeyBytes(0);
    expect(bytes).toEqual(pubkeyCache.getOrThrow(0).toBytes());
    expect(pubkeyCache.getPubkeyBytes(0)).not.toBe(bytes);
  });

  it("getPubkeyBytes returns undefined for out-of-range index", () => {
    expect(pubkeyCache.getPubkeyBytes(0xffffffff)).toBeUndefined();
  });

  it("getIndex returns null for unknown pubkey", () => {
    expect(pubkeyCache.getIndex(new Uint8Array(48))).toBeNull();
  });

  it("getIndex throws for invalid pubkey length", () => {
    expect(() => pubkeyCache.getIndex(new Uint8Array(47))).toThrow();
  });

  it("accepts identical replays and rejects conflicting replays", () => {
    const before = pubkeyCache.getOrThrow(0);
    pubkeyCache.append(0, keypairs[0].pubkeyBytes);
    expect(() => pubkeyCache.append(0, keypairs[1].pubkeyBytes)).toThrow("ConflictingPubkey");
    expect(() => pubkeyCache.append(0, new Uint8Array(1))).toThrow("InvalidPubkeyLength");

    const after = pubkeyCache.getOrThrow(0);
    expect(after.toBytes()).toEqual(before.toBytes());
    expect(after.toBytes()).toEqual(keypairs[0].pubkeyBytes);
  });

  it("reset clears both lookup directions and invalidates cached values", () => {
    const before = pubkeyCache.getOrThrow(0);

    pubkeyCache.reset();
    expect(pubkeyCache.size).toBe(0);
    expect(pubkeyCache.get(0)).toBeUndefined();
    expect(pubkeyCache.getIndex(keypairs[0].pubkeyBytes)).toBeNull();

    pubkeyCache.append(0, keypairs[1].pubkeyBytes);

    const after = pubkeyCache.getOrThrow(0);
    expect(after).not.toBe(before);
    expect(after.toBytes()).toEqual(keypairs[1].pubkeyBytes);
  });

  it("save replaces an existing file and load restores cache contents", () => {
    fs.writeFileSync(tempPkixPath, "stale");
    pubkeyCache.save(tempPkixPath);

    pubkeyCache.reset();
    pubkeyCache.append(0, keypairs[1].pubkeyBytes);
    const beforeLoad = pubkeyCache.getOrThrow(0);

    pubkeyCache.load(tempPkixPath, pubkeyCache.capacity);

    expectCacheContents();
    expect(pubkeyCache.getOrThrow(0)).not.toBe(beforeLoad);
  });

  it.runIf(process.platform === "linux")("save/load preserves a path longer than the former stack buffer", () => {
    let longDirectory = tempDir;
    for (let i = 0; i < 10; i++) {
      longDirectory = path.join(longDirectory, `${i.toString().padStart(2, "0")}-${"x".repeat(110)}`);
    }
    fs.mkdirSync(longDirectory, {recursive: true});
    const longPkixPath = path.join(longDirectory, "cache.pkix");
    expect(Buffer.byteLength(longPkixPath)).toBeGreaterThan(1_023);

    pubkeyCache.save(longPkixPath);
    expect(fs.existsSync(longPkixPath)).toBe(true);

    seedCache(1);
    pubkeyCache.load(longPkixPath, 2_000);
    expectCacheContents();
  });

  it("enforces the caller's load allocation limit", () => {
    pubkeyCache.save(tempPkixPath);

    expect(() => pubkeyCache.load(tempPkixPath, pubkeyCache.size - 1)).toThrow();
    expectCacheContents();

    const entryCount = pubkeyCache.size;
    expect(pubkeyCache.capacity).toBeGreaterThan(entryCount);
    pubkeyCache.load(tempPkixPath, entryCount);

    expect(pubkeyCache.capacity).toBe(entryCount);
    expectCacheContents();
  });

  it("rejects an invalid snapshot without replacing the live cache", () => {
    pubkeyCache.save(tempPkixPath);
    const invalid = Buffer.from(fs.readFileSync(tempPkixPath));
    invalid[invalid.length - 1] ^= 0xff;
    const invalidPath = path.join(tempDir, "invalid.pkix");
    fs.writeFileSync(invalidPath, invalid);

    expect(() => pubkeyCache.load(invalidPath, pubkeyCache.capacity)).toThrow();
    expectCacheContents();
  });

  it.runIf(canEnforceDirectoryPermissions)(
    "preserves an existing cache file when an atomic save cannot create its sibling file",
    () => {
      const readOnlyDir = path.join(tempDir, "read-only");
      const destination = path.join(readOnlyDir, "cache.pkix");
      fs.mkdirSync(readOnlyDir);

      pubkeyCache.save(destination);
      const original = fs.readFileSync(destination);
      seedCache(1);

      fs.chmodSync(readOnlyDir, 0o555);
      try {
        expect(() => pubkeyCache.save(destination)).toThrow();
      } finally {
        fs.chmodSync(readOnlyDir, 0o755);
      }

      expect(fs.readFileSync(destination)).toEqual(original);
      expect(fs.readdirSync(readOnlyDir)).toEqual(["cache.pkix"]);

      pubkeyCache.load(destination, pubkeyCache.capacity);
      expectCacheContents();
    }
  );

  it("reserves exact capacity after publishing entries without changing the cache", () => {
    const capacityBefore = pubkeyCache.capacity;
    const requestedCapacity = capacityBefore + 1;

    pubkeyCache.ensureCapacity(requestedCapacity);
    expect(pubkeyCache.capacity).toBe(requestedCapacity);
    expectCacheContents();
  });

  it("rejects sparse inserts without changing the cache", () => {
    const sizeBefore = pubkeyCache.size;
    expect(() => pubkeyCache.append(pubkeyCache.capacity, keypairs[0].pubkeyBytes)).toThrow();
    expect(pubkeyCache.size).toBe(sizeBefore);
  });
});
