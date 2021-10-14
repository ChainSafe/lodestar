import {itBench} from "@dapplion/benchmark";
import {expect} from "chai";
import {
  allForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {List} from "@chainsafe/ssz";
import {generatePerfTestCachedStateAltair} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {ssz} from "@chainsafe/lodestar-types";

// Aug 11 2021
// getAttestationsForBlock
//     ✓ getAttestationsForBlock                                             4.410948 ops/s    226.7086 ms/op        -         64 runs   51.8 s
describe("getAttestationsForBlock", () => {
  let originalState: allForks.CachedBeaconState<allForks.BeaconState>;

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = (generatePerfTestCachedStateAltair({
      goBackOneSlot: true,
    }) as unknown) as allForks.CachedBeaconState<allForks.BeaconState>;
    const numPreviousEpochParticipation = originalState.previousEpochParticipation.persistent
      .toArray()
      .filter((part) => part.timelySource).length;
    const numCurrentEpochParticipation = originalState.currentEpochParticipation.persistent
      .toArray()
      .filter((part) => part.timelySource).length;

    expect(numPreviousEpochParticipation).to.equal(250000, "Wrong numPreviousEpochParticipation");
    expect(numCurrentEpochParticipation).to.equal(250000, "Wrong numCurrentEpochParticipation");
  });

  itBench({
    id: "getAttestationsForBlock",
    beforeEach: () => getAggregatedAttestationPool(originalState),
    fn: (pool) => {
      // logger.info("Number of attestations in pool", pool.getAll().length);
      pool.getAttestationsForBlock(originalState);
    },
  });
});

function getAggregatedAttestationPool(
  state: allForks.CachedBeaconState<allForks.BeaconState>
): AggregatedAttestationPool {
  const pool = new AggregatedAttestationPool();
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = state.slot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = state.getCommitteeCountPerSlot(epoch);
    const sourceCheckpoint = {
      epoch: state.currentJustifiedCheckpoint.epoch,
      root: state.currentJustifiedCheckpoint.root.valueOf() as Uint8Array,
    };
    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      const attestation = {
        aggregationBits: Array.from({length: 64}, () => false) as List<boolean>,
        data: {
          slot: slot,
          index: committeeIndex,
          beaconBlockRoot: getBlockRootAtSlot(state, slot),
          source: sourceCheckpoint,
          target: {
            epoch,
            root: getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch)),
          },
        },
        signature: Buffer.alloc(96),
      };

      const committee = state.getBeaconCommittee(slot, committeeIndex);
      // all attestation has full participation so getAttestationsForBlock() has to do a lot of filter
      // aggregate_and_proof messages are all TreeBacked
      pool.add(ssz.phase0.Attestation.createTreeBackedFromStruct(attestation), committee, committee);
    }
  }
  return pool;
}
