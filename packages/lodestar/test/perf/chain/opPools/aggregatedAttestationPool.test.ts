import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {
  allForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {generatePerfTestCachedStateAltair} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {List} from "@chainsafe/ssz";
import {profilerLogger} from "@chainsafe/lodestar-beacon-state-transition/test/utils/logger";

// Since this test runs only 1 time, tracking it in the CI may not be stable but the performance in average is 60ms-80ms per operation.
// Jul-20 17:49:20.918 []                 info: Number of participations in state previousEpoch=250000, currentEpoch=250000
// Jul-20 17:49:20.922 []                 info: Number of attestations in pool 1952
//   getAttestationsForBlock
//     ✓ getAttestationsForBlock                                             13.53210 ops/s    73.89838 ms/op        -        203 runs   15.0 s
describe.skip("getAttestationsForBlock", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 1,
  });

  const originalState = (generatePerfTestCachedStateAltair({
    goBackOneSlot: true,
  }) as unknown) as allForks.CachedBeaconState<allForks.BeaconState>;
  const stateSlot = originalState.slot;
  const pool = new AggregatedAttestationPool();
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = stateSlot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = originalState.getCommitteeCountPerSlot(epoch);
    const sourceCheckpoint = {
      epoch: originalState.currentJustifiedCheckpoint.epoch,
      root: originalState.currentJustifiedCheckpoint.root.valueOf() as Uint8Array,
    };
    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      const attestation = {
        aggregationBits: Array.from({length: 64}, () => false) as List<boolean>,
        data: {
          slot: slot,
          index: committeeIndex,
          beaconBlockRoot: getBlockRootAtSlot(originalState, slot),
          source: sourceCheckpoint,
          target: {
            epoch,
            root: getBlockRootAtSlot(originalState, computeStartSlotAtEpoch(epoch)),
          },
        },
        signature: Buffer.alloc(96),
      };

      const committee = originalState.getBeaconCommittee(slot, committeeIndex);
      // all attestation has full participation so getAttestationsForBlock() has to do a lot of filter
      pool.add(attestation, committee, committee);
    }
  }
  const logger = profilerLogger();
  const numPreviousEpochParticipation = originalState.previousEpochParticipation.persistent
    .toArray()
    .filter((part) => part && part.timelySource).length;
  const numCurrentEpochParticipation = originalState.currentEpochParticipation.persistent
    .toArray()
    .filter((part) => part && part.timelySource).length;
  logger.info("Number of participations in state", {
    previousEpoch: numPreviousEpochParticipation,
    currentEpoch: numCurrentEpochParticipation,
  });
  logger.info("Number of attestations in pool", pool.getAll().length);
  itBench({id: "getAttestationsForBlock", beforeEach: () => originalState.clone()}, (state) => {
    pool.getAttestationsForBlock(state);
  });
});
