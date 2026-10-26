// Mirrors https://github.com/ChainSafe/swap-or-not-shuffle/tree/main/test/perf
import {bench, describe} from "@chainsafe/benchmark";
import * as shuffle from "../src/shuffle.js";
import * as shuffleReference from "../test/shuffleReference.ts";
import {deterministicBenchmarkSeed} from "./benchmarkSeed.js";

function getInputArray(count: number): Uint32Array {
  return Uint32Array.from(Array.from({length: count}, (_, i) => i));
}

for (const listSize of [16_384, 250_000, 1_000_000]) {
  describe(`shuffle list - ${listSize} indices`, () => {
    const seed = new Uint8Array(32).fill(0xac);
    const indices = getInputArray(listSize);
    const rounds = 10; // SHUFFLE_ROUNDS_MINIMAL

    bench({
      fn: () => {
        shuffleReference.unshuffleList(indices, seed, rounds);
      },
      id: `JS  - unshuffleList - ${listSize} indices`,
    });

    bench({
      fn: () => {
        shuffle.unshuffleList(indices, seed, rounds);
      },
      id: `zig - unshuffleList - ${listSize} indices`,
    });
  });
}

describe("committee indices", () => {
  for (const listSize of [16_384, 250_000, 1_000_000]) {
    const seed = deterministicBenchmarkSeed(`committee-indices:${listSize}`);
    const activeIndices = getInputArray(listSize);
    const syncBalanceIncrements = new Uint16Array(listSize).fill(32);
    const effectiveBalanceIncrements = new Uint16Array(listSize);
    for (let i = 0; i < listSize; i++) {
      effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
    }
    const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, SYNC_COMMITTEE_SIZE, SHUFFLE_ROUND_COUNT} =
      shuffleReference;

    bench({
      fn: () => {
        shuffleReference.naiveComputeSyncCommitteeIndicesElectra(seed, activeIndices, syncBalanceIncrements);
      },
      id: `JS  - computeSyncCommitteeIndicesElectra - ${listSize} indices - 32 ETH`,
    });

    bench({
      fn: () => {
        shuffle.computeSyncCommitteeIndices(
          seed,
          activeIndices,
          syncBalanceIncrements,
          2,
          SYNC_COMMITTEE_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT,
          SHUFFLE_ROUND_COUNT
        );
      },
      id: `zig - computeSyncCommitteeIndices - ${listSize} indices - 32 ETH`,
    });

    bench({
      fn: () => {
        shuffle.computeProposerIndex(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          2,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT,
          SHUFFLE_ROUND_COUNT
        );
      },
      id: `zig - computeProposerIndex - ${listSize} indices`,
    });
  }
});

describe("computePtcIndices - per slot", () => {
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, PTC_SIZE} = shuffleReference;
  for (const vc of [16_384, 250_000, 1_000_000]) {
    const seed = deterministicBenchmarkSeed(`ptc-indices:${vc}`);
    const indices = getInputArray(vc);
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);

    bench({
      fn: () => {
        shuffleReference.naiveComputePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, indices, seed);
      },
      id: `JS  - computePtcIndices - ${vc} indices`,
    });

    bench({
      fn: () => {
        shuffle.computePtcIndices(
          seed,
          indices,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        );
      },
      id: `zig - computePtcIndices - ${vc} indices`,
    });
  }
});

describe("computePtcIndicesForEpoch - full epoch (32 slots)", () => {
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, PTC_SIZE, SLOTS_PER_EPOCH} = shuffleReference;
  for (const vc of [250_000, 1_000_000]) {
    const shuffling = getInputArray(vc);
    const indicesPerSlot = Math.floor(vc / SLOTS_PER_EPOCH);
    const slotOffsets = new Uint32Array(SLOTS_PER_EPOCH + 1);
    for (let i = 0; i <= SLOTS_PER_EPOCH; i++) slotOffsets[i] = i * indicesPerSlot;
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);
    const epochSeed = deterministicBenchmarkSeed(`ptc-epoch:${vc}`);
    const startSlot = 0;

    const committees: Uint32Array[][] = new Array(SLOTS_PER_EPOCH);
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      committees[i] = [shuffling.subarray(slotOffsets[i], slotOffsets[i + 1])];
    }

    bench({
      fn: () => {
        shuffleReference.naiveComputePayloadTimelinessCommitteesForEpoch(
          epochSeed,
          startSlot,
          committees,
          effectiveBalanceIncrements
        );
      },
      id: `JS  - computePtcIndicesForEpoch - ${vc} validators`,
    });

    bench({
      fn: () => {
        shuffle.computePtcIndicesForEpoch(
          epochSeed,
          startSlot,
          SLOTS_PER_EPOCH,
          shuffling,
          slotOffsets,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        );
      },
      id: `zig - computePtcIndicesForEpoch - ${vc} validators`,
    });
  }
});
