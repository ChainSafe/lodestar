import path from "node:path";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {interopSecretKey} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {loadPubkeysFile, savePubkeysFile} from "../../../src/cmds/beacon/pubkeysFile.js";
import {testLogger} from "../../utils.js";

const logger = testLogger();
const MAX_CAPACITY = 1024;

function interopPubkeys(start: number, count: number): Uint8Array[] {
  return Array.from({length: count}, (_, i) =>
    interopSecretKey(start + i)
      .toPublicKey()
      .toBytes()
  );
}

function loadWithAnchorPubkeys(filepath: string, pubkeys: Uint8Array[], maxCapacity = MAX_CAPACITY): void {
  const anchorStateBytes = ssz.phase0.BeaconState.serialize({
    ...ssz.phase0.BeaconState.defaultValue(),
    validators: pubkeys.map((pubkey) => ({...ssz.phase0.Validator.defaultValue(), pubkey})),
  });
  loadPubkeysFile(pubkeyCache, filepath, maxCapacity, config, anchorStateBytes, pubkeys.length, logger);
}

function saveCacheWith(pubkeys: Uint8Array[], filepath: string): void {
  pubkeys.forEach((pubkey, i) => pubkeyCache.append(i, pubkey));
  savePubkeysFile(pubkeyCache, filepath, logger);
  pubkeyCache.reset();
}

describe("cmds / beacon / pubkeysFile", () => {
  let tmpDir: tmp.DirResult;
  let filepath: string;

  beforeEach(() => {
    pubkeyCache.reset();
    tmpDir = tmp.dirSync({unsafeCleanup: true});
    filepath = path.join(tmpDir.name, "pubkeys");
  });

  afterEach(() => {
    pubkeyCache.reset();
    tmpDir.removeCallback();
  });

  it("loads a saved cache matching the anchor state", () => {
    const pubkeys = interopPubkeys(0, 8);
    saveCacheWith(pubkeys, filepath);

    loadWithAnchorPubkeys(filepath, pubkeys);

    expect(pubkeyCache.size).toBe(pubkeys.length);
    for (let i = 0; i < pubkeys.length; i++) {
      expect(pubkeyCache.getPubkeyBytes(i), `wrong pubkey at index ${i}`).toEqual(pubkeys[i]);
    }
  });

  it("truncates a legacy unfinalized suffix to the anchor validator count", () => {
    const pubkeys = interopPubkeys(0, 8);
    saveCacheWith(pubkeys, filepath);

    loadWithAnchorPubkeys(filepath, pubkeys.slice(0, 6));

    expect(pubkeyCache.size).toBe(6);
    expect(pubkeyCache.getPubkeyBytes(6)).toBeUndefined();
    expect(pubkeyCache.getIndex(pubkeys[6])).toBeNull();
    const canonicalPubkey = interopPubkeys(100, 1)[0];
    pubkeyCache.append(6, canonicalPubkey);
    expect(pubkeyCache.getPubkeyBytes(6)).toEqual(canonicalPubkey);
  });

  it("truncates the entire cache for an empty anchor registry", () => {
    saveCacheWith(interopPubkeys(0, 8), filepath);

    loadWithAnchorPubkeys(filepath, []);

    expect(pubkeyCache.size).toBe(0);
  });

  it("discards a saved cache not matching the anchor state", () => {
    saveCacheWith(interopPubkeys(0, 8), filepath);

    loadWithAnchorPubkeys(filepath, interopPubkeys(100, 8));

    expect(pubkeyCache.size).toBe(0);
  });

  it("discards an interior branch swap with equal counts and matching endpoints", () => {
    const [anchor, keyA, keyB, keyC] = interopPubkeys(0, 4);
    saveCacheWith([anchor, keyA, keyB, keyC], filepath);

    loadWithAnchorPubkeys(filepath, [anchor, keyB, keyA, keyC]);

    expect(pubkeyCache.size).toBe(0);
    const validators = [anchor, keyB, keyA, keyC].map((pubkey) => ({...ssz.phase0.Validator.defaultValue(), pubkey}));
    pubkeyCache.syncPubkeys(validators);
    expect(pubkeyCache.getPubkeyBytes(1)).toEqual(keyB);
    expect(pubkeyCache.getPubkeyBytes(2)).toEqual(keyA);
    expect(pubkeyCache.getIndex(keyB)).toBe(1);
    expect(pubkeyCache.getIndex(keyA)).toBe(2);
  });

  it("leaves the cache empty when the file is missing", () => {
    loadWithAnchorPubkeys(filepath, interopPubkeys(0, 8));

    expect(pubkeyCache.size).toBe(0);
  });

  it("leaves the cache empty when the file exceeds max capacity", () => {
    const pubkeys = interopPubkeys(0, 8);
    saveCacheWith(pubkeys, filepath);

    loadWithAnchorPubkeys(filepath, pubkeys, pubkeys.length - 1);

    expect(pubkeyCache.size).toBe(0);
  });
});
