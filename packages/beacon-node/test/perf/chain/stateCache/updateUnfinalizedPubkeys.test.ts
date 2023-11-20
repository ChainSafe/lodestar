import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconStateAllForks, PubkeyIndexMap} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {generateCached6110State} from "../../../utils/state.js";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache/index.js";

import {OrderedMap} from "immutable";
import { interopPubkeysCached } from "../../../../../state-transition/test/utils/interop.js";

// Benchmark date from Mon Nov 21 2023 - Intel Core i7-9750H @ 2.60Ghz
//     ✔ updateUnfinalizedPubkeys - updating 10 pubkeys                      795.3254 ops/s    1.257347 ms/op        -         63 runs   2.86 s
//     ✔ updateUnfinalizedPubkeys - updating 100 pubkeys                     92.20117 ops/s    10.84585 ms/op        -         36 runs   1.73 s
//     ✔ updateUnfinalizedPubkeys - updating 1000 pubkeys                    3.881592 ops/s    257.6262 ms/op        -         16 runs   5.19 s
describe("updateUnfinalizedPubkeys perf tests", function () {
  setBenchOpts({noThreshold: true});

  const numPubkeysToBeFinalizedCases = [10, 100, 1000]
  const numCheckpointStateCache = 8;
  const numStateCache = 3 * 32;

  let baseState: CachedBeaconStateAllForks;
  let checkpointStateCache: CheckpointStateCache;
  let stateCache: StateContextCache;
  let unfinalizedPubkey2Index: PubkeyIndexMap;


  for (const numPubkeysToBeFinalized of numPubkeysToBeFinalizedCases) {
    itBench({
      id: `updateUnfinalizedPubkeys - updating ${numPubkeysToBeFinalized} pubkeys`,
      before: async() => {
        unfinalizedPubkey2Index = generatePubkey2Index(0, Math.max.apply(null, numPubkeysToBeFinalizedCases));
        baseState = generateCached6110State();
      },
      beforeEach: async() => {
        baseState.epochCtx.unfinalizedPubkey2index = OrderedMap(unfinalizedPubkey2Index.map);
        baseState.epochCtx.pubkey2index = new PubkeyIndexMap();
        baseState.epochCtx.index2pubkey = [];

        checkpointStateCache = new CheckpointStateCache({});
        stateCache = new StateContextCache({});
    
        for (let i = 0; i < numCheckpointStateCache; i++) {
          const clonedState = baseState.clone();
          const checkpoint = ssz.phase0.Checkpoint.defaultValue();

          clonedState.slot = i;
          checkpoint.epoch = i; // Assigning arbitrary non-duplicate values to ensure checkpointStateCache correctly saves all the states

          checkpointStateCache.add(checkpoint, clonedState);
        }
    
        for (let i = 0; i < numStateCache; i++) {
          const clonedState = baseState.clone();
          clonedState.slot = i;
          stateCache.add(clonedState);
        }
      },
      fn: async() => {
        const newFinalizedValidators = baseState.epochCtx.unfinalizedPubkey2index.takeWhile(
          (index, _pubkey) => index < numPubkeysToBeFinalized
        );
        checkpointStateCache.updateUnfinalizedPubkeys(newFinalizedValidators);
        stateCache.updateUnfinalizedPubkeys(newFinalizedValidators);
      }});
  }

  function generatePubkey2Index(startIndex: number, endIndex: number): PubkeyIndexMap {
    let pubkey2Index = new PubkeyIndexMap();
    const pubkeys = interopPubkeysCached(endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i++) {
      pubkey2Index.set(pubkeys[i], i);
    }

    return pubkey2Index;
  }

});
