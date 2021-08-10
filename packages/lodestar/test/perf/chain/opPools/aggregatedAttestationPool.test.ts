import {itBench, setBenchOpts} from "@dapplion/benchmark";
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

// Jul-21 09:20:46.653 []                 info: Number of participations in state previousEpoch=250000, currentEpoch=250000
// Jul-21 09:23:38.382 []                 info: Number of attestations in pool 1952
//   getAttestationsForBlock
//     ✓ getAttestationsForBlock                                             14.06524 ops/s    71.09726 ms/op        -         64 runs   31.9 s
describe("getAttestationsForBlock", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  let originalState: allForks.CachedBeaconState<allForks.BeaconState>;

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = (generatePerfTestCachedStateAltair({
      goBackOneSlot: true,
    }) as unknown) as allForks.CachedBeaconState<allForks.BeaconState>;
    const numPreviousEpochParticipation = originalState.previousEpochParticipation.persistent
      .toArray()
      .filter((part) => part && part.timelySource).length;
    const numCurrentEpochParticipation = originalState.currentEpochParticipation.persistent
      .toArray()
      .filter((part) => part && part.timelySource).length;

    expect(numPreviousEpochParticipation).to.equal(250000, "Wrong numPreviousEpochParticipation");
    expect(numCurrentEpochParticipation).to.equal(250000, "Wrong numCurrentEpochParticipation");
  });

  itBench(
    {
      id: "getAttestationsForBlock",
      beforeEach: () => getAggregatedAttestationPool(originalState),
    },
    (pool) => {
      // logger.info("Number of attestations in pool", pool.getAll().length);
      pool.getAttestationsForBlock(originalState);
    }
  );
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
      pool.add(attestation, committee, committee);
    }
  }
  return pool;
}
