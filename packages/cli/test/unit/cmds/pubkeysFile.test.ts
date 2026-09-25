import path from "node:path";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
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

function stateWithPubkeys(pubkeys: Uint8Array[]): BeaconStateAllForks {
  return ssz.phase0.BeaconState.toViewDU({
    ...ssz.phase0.BeaconState.defaultValue(),
    validators: pubkeys.map((pubkey) => ({...ssz.phase0.Validator.defaultValue(), pubkey})),
  });
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

    loadPubkeysFile(pubkeyCache, filepath, stateWithPubkeys(pubkeys.slice(0, 6)), MAX_CAPACITY, logger);

    expect(pubkeyCache.size).toBe(pubkeys.length);
    for (let i = 0; i < pubkeys.length; i++) {
      expect(pubkeyCache.getPubkeyBytes(i), `wrong pubkey at index ${i}`).toEqual(pubkeys[i]);
    }
  });

  it("discards a saved cache not matching the anchor state", () => {
    saveCacheWith(interopPubkeys(0, 8), filepath);

    loadPubkeysFile(pubkeyCache, filepath, stateWithPubkeys(interopPubkeys(100, 8)), MAX_CAPACITY, logger);

    expect(pubkeyCache.size).toBe(0);
  });

  it("leaves the cache empty when the file is missing", () => {
    loadPubkeysFile(pubkeyCache, filepath, stateWithPubkeys(interopPubkeys(0, 8)), MAX_CAPACITY, logger);

    expect(pubkeyCache.size).toBe(0);
  });

  it("leaves the cache empty when the file exceeds max capacity", () => {
    const pubkeys = interopPubkeys(0, 8);
    saveCacheWith(pubkeys, filepath);

    loadPubkeysFile(pubkeyCache, filepath, stateWithPubkeys(pubkeys), pubkeys.length - 1, logger);

    expect(pubkeyCache.size).toBe(0);
  });
});
