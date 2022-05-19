import {itBench} from "@dapplion/benchmark";
import {expect} from "chai";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {SLOTS_PER_EPOCH, TIMELY_SOURCE_FLAG_INDEX} from "@chainsafe/lodestar-params";
import {generatePerfTestCachedStateAltair} from "../../../../../beacon-state-transition/test/perf/util.js";
import {BitArray} from "@chainsafe/ssz";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
function flagIsTimelySource(flag: number): boolean {
  return (flag & TIMELY_SOURCE) === TIMELY_SOURCE;
}

// Aug 11 2021
// getAttestationsForBlock
//     ✓ getAttestationsForBlock                                             4.410948 ops/s    226.7086 ms/op        -         64 runs   51.8 s
describe("getAttestationsForBlock", () => {
  let originalState: CachedBeaconStateAltair;

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});

    const previousEpochParticipationArr = originalState.previousEpochParticipation.getAll();
    const currentEpochParticipationArr = originalState.currentEpochParticipation.getAll();

    const numPreviousEpochParticipation = previousEpochParticipationArr.filter(flagIsTimelySource).length;
    const numCurrentEpochParticipation = currentEpochParticipationArr.filter(flagIsTimelySource).length;

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

function getAggregatedAttestationPool(state: CachedBeaconStateAltair): AggregatedAttestationPool {
  const pool = new AggregatedAttestationPool();
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = state.slot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = state.epochCtx.getCommitteeCountPerSlot(epoch);
    const sourceCheckpoint = {
      epoch: state.currentJustifiedCheckpoint.epoch,
      root: state.currentJustifiedCheckpoint.root,
    };
    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      const attestation = {
        aggregationBits: BitArray.fromBitLen(64),
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

      const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
      // all attestation has full participation so getAttestationsForBlock() has to do a lot of filter
      // aggregate_and_proof messages
      pool.add(attestation, committee.length, committee);
    }
  }
  return pool;
}
