import {bench, describe} from "@chainsafe/benchmark";
import {ForkSeq} from "@lodestar/params";
import {
  computeShuffledIndex,
  getComputeShuffledIndexFn,
  getNextSyncCommitteeIndices,
  naiveGetNextSyncCommitteeIndices,
} from "../../../src/util/seed.js";
import {generatePerfTestCachedStateAltair} from "../util.js";

describe("getNextSyncCommitteeIndices electra", () => {
  for (const vc of [1_000, 10_000, 100_000]) {
    const state = generatePerfTestCachedStateAltair({vc, goBackOneSlot: false});
    const activeIndices = Array.from({length: state.validators.length}, (_, i) => i);
    const effectiveBalanceIncrements = new Uint16Array(state.validators.length);
    for (let i = 0; i < state.validators.length; i++) {
      // make it the worse case where each validator has 32 ETH effective balance
      effectiveBalanceIncrements[i] = 32;
    }

    bench({
      id: `naiveGetNextSyncCommitteeIndices ${vc} validators`,
      fn: () => {
        naiveGetNextSyncCommitteeIndices(ForkSeq.electra, state, activeIndices, effectiveBalanceIncrements);
      },
    });

    bench({
      id: `getNextSyncCommitteeIndices ${vc} validators`,
      fn: () => {
        getNextSyncCommitteeIndices(ForkSeq.electra, state, activeIndices, effectiveBalanceIncrements);
      },
    });
  }
});

describe("computeShuffledIndex", () => {
  // TODO
  const vc = 100_000;
  const seed = new Uint8Array(Array.from({length: 32}, (_, i) => i));

  bench({
    id: `naive computeShuffledIndex ${vc} validators`,
    fn: () => {
      for (let i = 0; i < vc; i++) {
        computeShuffledIndex(i, vc, seed);
      }
    },
  });

  const shuffledIndexFn = getComputeShuffledIndexFn(vc, seed);

  bench({
    id: `cached computeShuffledIndex ${vc} validators`,
    fn: () => {
      for (let i = 0; i < vc; i++) {
        shuffledIndexFn(i);
      }
    },
  });
});
