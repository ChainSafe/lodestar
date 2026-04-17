import {bench, describe} from "@chainsafe/benchmark";
import {ForkSeq} from "@lodestar/params";
import {fromHex} from "@lodestar/utils";
import {generatePerfTestCachedStateAltair, generatePerfTestCachedStateElectra} from "../../../src/testUtils/util.js";
import {
  computePayloadTimelinessCommitteeForSlot,
  computePayloadTimelinessCommitteesForEpoch,
  computeProposerIndex,
  computeShuffledIndex,
  getNextSyncCommitteeIndices,
  naiveComputePayloadTimelinessCommitteeForSlot,
  naiveComputePayloadTimelinessCommitteesForEpoch,
  naiveComputeProposerIndex,
  naiveGetNextSyncCommitteeIndices,
} from "../../../src/util/seed.js";

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

  const activeIndices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
  const runsFactor = 100;
  // enable this if you want to see the naive version performance
  bench.skip({
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
    const activeIndices = new Uint32Array(Array.from({length: state.validators.length}, (_, i) => i));
    const effectiveBalanceIncrements = new Uint16Array(state.validators.length);
    for (let i = 0; i < state.validators.length; i++) {
      // make it the worse case where each validator has 32 ETH effective balance
      effectiveBalanceIncrements[i] = 32;
    }

    // enable this if you want to see the naive version performance
    bench.skip({
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
    // enable this if you want to see the naive version performance
    bench.skip({
      id: `naive computeShuffledIndex ${vc} validators`,
      fn: () => {
        for (let i = 0; i < vc; i++) {
          computeShuffledIndex(i, vc, seed);
        }
      },
    });
  }
});

describe("computePayloadTimelinessCommitteeForSlot - pure TS vs Rust magic (250k-1M validators)", () => {
  for (const vc of [250_000, 1_000_000]) {
    const seed = new Uint8Array(32).fill(1);
    const indices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);
    const slotCommittees = [indices]; // single committee spanning all validators

    bench({
      id: `naive TS - naiveComputePayloadTimelinessCommitteeForSlot - ${vc} validators`,
      fn: () => {
        naiveComputePayloadTimelinessCommitteeForSlot(seed, slotCommittees, effectiveBalanceIncrements);
      },
    });

    bench({
      id: `(uses native Rust) -computePayloadTimelinessCommitteeForSlot - ${vc} validators`,
      fn: () => {
        computePayloadTimelinessCommitteeForSlot(seed, slotCommittees, effectiveBalanceIncrements);
      },
    });
  }
});

describe("computePayloadTimelinessCommitteesForEpoch - pure TS vs  Rust magic (250k -1M validators)", () => {
  for (const vc of [250_000, 1_000_000]) {
    const cachedState = generatePerfTestCachedStateElectra({goBackOneSlot: false, vc});
    const {epochCtx} = cachedState;
    const epoch = epochCtx.epoch;
    const {effectiveBalanceIncrements} = epochCtx;

    // eslint-disable-next-line no-console
    console.log(`[vc=${vc}] effectiveBalanceIncrements[0]=${effectiveBalanceIncrements[0]}`);

    const naiveResult = naiveComputePayloadTimelinessCommitteesForEpoch(
      cachedState,
      epoch,
      epochCtx.currentShuffling.committees,
      effectiveBalanceIncrements
    );
    const rustResult = computePayloadTimelinessCommitteesForEpoch(
      cachedState,
      epoch,
      epochCtx.currentShuffling,
      effectiveBalanceIncrements
    );
    for (let i = 0; i < naiveResult.length; i++) {
      const naive = naiveResult[i];
      const rust = rustResult[i];
      if (naive.length !== rust.length) {
        throw new Error(`PTC length mismatch at slot ${i} (vc=${vc}): naive=${naive.length} rust=${rust.length}`);
      }
      for (let j = 0; j < naive.length; j++) {
        if (naive[j] !== rust[j]) {
          throw new Error(
            `PTC index mismatch at slot ${i} position ${j} (vc=${vc}): naive=${naive[j]} rust=${rust[j]}`
          );
        }
      }
    }

    bench({
      id: `naive TS - naiveComputePayloadTimelinessCommitteesForEpoch - ${vc} validators`,
      fn: () => {
        naiveComputePayloadTimelinessCommitteesForEpoch(
          cachedState,
          epoch,
          epochCtx.currentShuffling.committees,
          effectiveBalanceIncrements
        );
      },
    });

    bench({
      id: `(uses native Rust) -computePayloadTimelinessCommitteesForEpoch - ${vc} validators`,
      fn: () => {
        computePayloadTimelinessCommitteesForEpoch(
          cachedState,
          epoch,
          epochCtx.currentShuffling,
          effectiveBalanceIncrements
        );
      },
    });
  }
});
