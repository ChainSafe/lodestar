import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {expect} from "chai";
import {allForks, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {generatePerfTestCachedStateAltair} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {IVoteTracker} from "../../../src/protoArray/interface";
import {computeDeltas} from "../../../src/protoArray/computeDeltas";

describe("computeDeltas", () => {
  let originalState: allForks.CachedBeaconState<allForks.BeaconState>;
  const indices: Map<string, number> = new Map<string, number>();
  const oldBalances: number[] = [];
  const newBalances: number[] = [];
  const oldRoot = "0x32dec344944029ba183ac387a7aa1f2068591c00e9bfadcfb238e50fbe9ea38e";
  const newRoot = "0xb59f3a209f639dd6b5645ea9fad8d441df44c3be93bd1bbf50ef90bf124d1238";

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = (generatePerfTestCachedStateAltair({
      goBackOneSlot: true,
    }) as unknown) as allForks.CachedBeaconState<allForks.BeaconState>;
    const numPreviousEpochParticipation = originalState.previousEpochParticipation.persistent
      .toArray()
      .filter((part) => part !== undefined && part.timelySource).length;
    const numCurrentEpochParticipation = originalState.currentEpochParticipation.persistent
      .toArray()
      .filter((part) => part !== undefined && part.timelySource).length;

    expect(numPreviousEpochParticipation).to.equal(250000, "Wrong numPreviousEpochParticipation");
    expect(numCurrentEpochParticipation).to.equal(250000, "Wrong numCurrentEpochParticipation");
    for (let i = 0; i < numPreviousEpochParticipation; i++) {
      oldBalances.push(32);
      newBalances.push(32);
    }
    for (let i = 0; i < 10000; i++) {
      indices.set("" + i, i);
    }
    indices.set(oldRoot, 1001);
    indices.set(newRoot, 1001);
  });

  setBenchOpts({
    minMs: 30 * 1000,
    maxMs: 40 * 1000,
  });

  itBench({
    id: "computeDeltas",
    beforeEach: () => {
      const votes: IVoteTracker[] = [];
      const epoch = originalState.currentShuffling.epoch;
      const committee = originalState.getBeaconCommittee(computeStartSlotAtEpoch(epoch), 0);
      for (let i = 0; i < 250000; i++) {
        if (committee.includes(i)) {
          votes.push({
            currentRoot: oldRoot,
            nextRoot: newRoot,
            nextEpoch: epoch,
          });
        } else {
          votes.push({
            currentRoot: oldRoot,
            nextRoot: oldRoot,
            nextEpoch: epoch - 1,
          });
        }
      }
      return votes;
    },
    fn: (votes) => {
      computeDeltas(indices, votes, oldBalances, newBalances);
    },
  });
});
