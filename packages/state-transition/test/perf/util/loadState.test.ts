import fs from "node:fs";
import path from "node:path";
import {expect} from "chai";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/blst";
import {fromHexString} from "@chainsafe/ssz";
import {itBench} from "@dapplion/benchmark";
import {ssz} from "@lodestar/types";
import {config as defaultChainConfig} from "@lodestar/config/default";
import {createBeaconConfig} from "@lodestar/config";
import {loadState} from "../../../src/util/loadState.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {Index2PubkeyCache, PubkeyIndexMap} from "../../../src/cache/pubkeyCache.js";

describe("loadState", function () {
  this.timeout(0);
  const stateType = ssz.capella.BeaconState;

  const folder = "/Users/tuyennguyen/tuyen/state_migration";
  const data = Uint8Array.from(fs.readFileSync(path.join(folder, "mainnet_state_7335296.ssz")));

  const seedState = stateType.deserializeToViewDU(data);
  // cache all HashObjects
  seedState.hashTreeRoot();
  const config = createBeaconConfig(defaultChainConfig, seedState.genesisValidatorsRoot);
  // TODO: EIP-6110 - need to create 2 separate caches?
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey: Index2PubkeyCache = [];
  const cachedSeedState = createCachedBeaconState(seedState, {
    config,
    pubkey2index,
    index2pubkey,
  });

  const newStateBytes = Uint8Array.from(fs.readFileSync(path.join(folder, "mainnet_state_7335360.ssz")));
  // const stateRoot6543072 = fromHexString("0xcf0e3c93b080d1c870b9052031f77e08aecbbbba5e4e7b1898b108d76c981a31");
  // const stateRoot7335296 = fromHexString("0xc63b580b63b78c83693ff2b8897cf0e4fcbc46b8a2eab60a090b78ced36afd93");
  const stateRoot7335360 = fromHexString("0xaeb2f977a1502967e09394e81b8bcfdd5a077af82b99deea0dcd3698568efbeb");
  const newStateRoot = stateRoot7335360;
  // IMPORTANT: should not load a new separate tree (enable the code below) or the number is not correct (too bad)
  // const newState = stateType.deserializeToViewDU(newStateBytes);
  // startTime = Date.now();
  // const newStateRoot = newState.hashTreeRoot();
  // console.log("state root of state", toHexString(newStateRoot));
  // console.log("@@@ hashTreeRoot of new state in", Date.now() - startTime, "ms");

  /**
   * My Mac M1 Pro 17:30 Sep 16 2023
   * ✔ migrate state from slot 7335296 64 slots difference                0.4225908 ops/s    2.366355  s/op        -         14 runs   35.9 s
   * ✔ migrate state from slot 7327776 1 day difference                   0.3415936 ops/s    2.927455  s/op        -         17 runs   52.6 s
   * Memory diff:
   * - 64 slots: 104.01 MB
   * - 1 day: 113.49 MB
   */
  itBench(`migrate state from slot ${seedState.slot} 64 slots difference`, () => {
    const {state: migratedState, modifiedValidators} = loadState(config, seedState, newStateBytes);
    expect(ssz.Root.equals(migratedState.hashTreeRoot(), newStateRoot)).to.be.true;
    // Get the validators sub tree once for all the loop
    const validators = migratedState.validators;
    for (const validatorIndex of modifiedValidators) {
      const validator = validators.getReadonly(validatorIndex);
      const pubkey = validator.pubkey;
      pubkey2index.set(pubkey, validatorIndex);
      index2pubkey[validatorIndex] = bls.PublicKey.fromBytes(pubkey, CoordType.jacobian);
    }
    createCachedBeaconState(
      migratedState,
      {
        config,
        pubkey2index,
        index2pubkey,
        // TODO: maintain a ShufflingCache given an epoch and dependentRoot to avoid recompute shuffling
        previousShuffling: cachedSeedState.epochCtx.previousShuffling,
        currentShuffling: cachedSeedState.epochCtx.currentShuffling,
        nextShuffling: cachedSeedState.epochCtx.nextShuffling,
      },
      {skipSyncPubkeys: true, skipComputeShuffling: true}
    );
  });
});
