import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {Map} from "immutable";
import {PubkeyIndexMap} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {interopPubkeysCached} from "@lodestar/state-transition/test/utils/interop.js";
import {generateCached6110State} from "../../../utils/state.js";
import {CheckpointStateCache, StateContextCache} from "../../../../src/chain/stateCache/index.js";

// Benchmark date from Mon Nov 21 2023 - Intel Core i7-9750H @ 2.60Ghz
// ✔ updateUnfinalizedPubkeys - updating 10 pubkeys                      1496.612 ops/s    668.1760 us/op        -        276 runs   3.39 s
// ✔ updateUnfinalizedPubkeys - updating 100 pubkeys                     174.9926 ops/s    5.714528 ms/op        -        142 runs   2.19 s
// ✔ updateUnfinalizedPubkeys - updating 1000 pubkeys                    10.17848 ops/s    98.24650 ms/op        -         28 runs   3.75 s
describe("updateUnfinalizedPubkeys perf tests", function () {
  setBenchOpts({noThreshold: true});

  const numPubkeysToBeFinalizedCases = [10, 100, 1000];
  const numCheckpointStateCache = 8;
  const numStateCache = 3 * 32;

  let checkpointStateCache: CheckpointStateCache;
  let stateCache: StateContextCache;

  const unfinalizedPubkey2Index = generatePubkey2Index(0, Math.max.apply(null, numPubkeysToBeFinalizedCases));
  const baseState = generateCached6110State();

  for (const numPubkeysToBeFinalized of numPubkeysToBeFinalizedCases) {
    itBench({
      id: `updateUnfinalizedPubkeys - updating ${numPubkeysToBeFinalized} pubkeys`,
      beforeEach: async () => {
        baseState.epochCtx.unfinalizedPubkey2index = Map(unfinalizedPubkey2Index.map);
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
      fn: async () => {
        const newFinalizedValidators = baseState.epochCtx.unfinalizedPubkey2index.filter(
          (index, _pubkey) => index < numPubkeysToBeFinalized
        );
        stateCache.updateUnfinalizedPubkeys(newFinalizedValidators);
        stateCache.updateUnfinalizedPubkeys.bind(checkpointStateCache)(newFinalizedValidators);
      },
    });
  }

  function generatePubkey2Index(startIndex: number, endIndex: number): PubkeyIndexMap {
    const pubkey2Index = new PubkeyIndexMap();
    const pubkeys = interopPubkeysCached(endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i++) {
      pubkey2Index.set(pubkeys[i], i);
    }

    return pubkey2Index;
  }
});
