import {bench, describe} from "@chainsafe/benchmark";
import {ForkSeq} from "@lodestar/params";
import {fromHex} from "@lodestar/utils";
import {
  computeProposerIndex,
  computeShuffledIndex,
  getComputeShuffledIndexFn,
  getNextSyncCommitteeIndices,
  naiveComputeProposerIndex,
  naiveGetNextSyncCommitteeIndices,
} from "../../../src/util/seed.js";
import {generatePerfTestCachedStateAltair} from "../util.js";

// I'm not sure how to populate a good test data for this benchmark
describe("computeProposerIndex", () => {
  // it's hard to find a seed that shows differences between naive and optimized version
  // this was selected after a couple of time I run and try crytpo.randomBytes()
  const seed = fromHex("0x902199936ba358175ec5eca9825fd0d26fc355d5fd4d37d1b10575a29d4bd5a8");

  const vc = 100_000;
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    // make it the worse case where each validator has 32 ETH effective balance
    effectiveBalanceIncrements[i] = 32;
  }

  const activeIndices = Array.from({length: vc}, (_, i) => i);
  const runsFactor = 100;
  bench({
    id: `naive computeProposerIndex ${vc} validators`,
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        naiveComputeProposerIndex(ForkSeq.electra, effectiveBalanceIncrements, activeIndices, seed);
      }
    },
    runsFactor,
  });

  bench({
    id: `computeProposerIndex ${vc} validators`,
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        computeProposerIndex(ForkSeq.electra, effectiveBalanceIncrements, activeIndices, seed);
      }
    },
    runsFactor,
  });
});

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
  const seed = new Uint8Array(Array.from({length: 32}, (_, i) => i));

  for (const vc of [100_000, 2_000_000]) {
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
  }
});
