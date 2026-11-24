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
    saveCacheWith(pubkeys.slice(0, 6), filepath);

    loadWithAnchorPubkeys(filepath, pubkeys);

    expect(pubkeyCache.size).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(pubkeyCache.getPubkeyBytes(i), `wrong pubkey at index ${i}`).toEqual(pubkeys[i]);
    }
  });

  it("drops saved entries beyond the anchor state so another branch can assign their indices", () => {
    const pubkeys = interopPubkeys(0, 8);
    const anchorPubkeys = pubkeys.slice(0, 6);
    saveCacheWith(pubkeys, filepath);

    loadWithAnchorPubkeys(filepath, anchorPubkeys);

    expect(pubkeyCache.size).toBe(anchorPubkeys.length);
    for (let i = 0; i < anchorPubkeys.length; i++) {
      expect(pubkeyCache.getPubkeyBytes(i), `wrong pubkey at index ${i}`).toEqual(anchorPubkeys[i]);
    }
    expect(pubkeyCache.getIndex(pubkeys[6])).toBeNull();

    pubkeyCache.append(6, pubkeys[7]);
    expect(pubkeyCache.getPubkeyBytes(6)).toEqual(pubkeys[7]);
  });

  it("discards a saved cache not matching the anchor state", () => {
    saveCacheWith(interopPubkeys(0, 8), filepath);

    loadWithAnchorPubkeys(filepath, interopPubkeys(100, 8));

    expect(pubkeyCache.size).toBe(0);
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
