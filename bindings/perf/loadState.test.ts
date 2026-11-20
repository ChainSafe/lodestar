import {bench, describe} from "@chainsafe/benchmark";
import {config} from "@lodestar/config/default";
import * as era from "@lodestar/era";
import {loadState as loadStateTS} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import bindings from "../src/index.js";
import {getEraFilePaths} from "../test/eraFiles.ts";
import {getPubkeyCacheCapacityForState, getSerializedGenesisValidatorsRoot} from "../test/serializedState.ts";

async function readSerializedState(path: string): Promise<Uint8Array> {
  const reader = await era.era.EraReader.open(config, path);
  const bytes = await reader.readSerializedState();
  await reader.close();
  return bytes;
}

// Load a later state onto an earlier seed so the validator and inactivity-score diffs are non-empty.
const [seedEraPath, nextEraPath] = getEraFilePaths();
const seedStateBytes = await readSerializedState(seedEraPath);
const stateBytes = await readSerializedState(nextEraPath);
const requiredPubkeyCapacity = Math.max(
  getPubkeyCacheCapacityForState(seedStateBytes),
  getPubkeyCacheCapacityForState(stateBytes)
);

let loadedPkix = false;
try {
  bindings.pubkeys.load("./mainnet.pkix", requiredPubkeyCapacity);
  loadedPkix = true;
} catch (_e) {
  // Rebuild incompatible or corrupt snapshots from the serialized state.
}
if (!loadedPkix || bindings.pubkeys.capacity() < requiredPubkeyCapacity) {
  bindings.pubkeys.ensureCapacity(requiredPubkeyCapacity);
}

const nativeConfig = new bindings.BeaconConfig(config, getSerializedGenesisValidatorsRoot(seedStateBytes));
const seedState = bindings.BeaconStateView.createFromBytes(seedStateBytes, nativeConfig);
const seedValidatorsBytes = seedState.serializeValidators();

const tsSeedState = ssz.fulu.BeaconState.deserializeToViewDU(seedStateBytes);

describe("loadState next era: native vs TS (mainnet)", () => {
  bench({
    fn: () => {
      seedState.loadOtherStateBench(stateBytes);
    },
    id: "native (internal serialize seed)",
  });

  bench({
    fn: () => {
      loadStateTS(config, tsSeedState, stateBytes);
    },
    id: "TS (internal serialize seed)",
  });

  bench({
    fn: () => {
      seedState.loadOtherStateBench(stateBytes, seedValidatorsBytes);
    },
    id: "native (prebuilt seedValidatorsBytes)",
  });

  bench({
    fn: () => {
      loadStateTS(config, tsSeedState, stateBytes, seedValidatorsBytes);
    },
    id: "TS (prebuilt seedValidatorsBytes)",
  });
});
