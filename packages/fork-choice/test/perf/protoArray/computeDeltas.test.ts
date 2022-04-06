import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {expect} from "chai";
import {
  CachedBeaconStateAltair,
  computeStartSlotAtEpoch,
  EffectiveBalanceIncrements,
  getEffectiveBalanceIncrementsZeroed,
} from "@chainsafe/lodestar-beacon-state-transition";
import {generatePerfTestCachedStateAltair} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {TIMELY_SOURCE_FLAG_INDEX} from "@chainsafe/lodestar-params";
import {IVoteTracker} from "../../../src/protoArray/interface.js";
import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";
import {computeProposerBoostScoreFromBalances} from "../../../src/forkChoice/forkChoice.js";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
function flagIsTimelySource(flag: number): boolean {
  return (flag & TIMELY_SOURCE) === TIMELY_SOURCE;
}

describe("computeDeltas", () => {
  let originalState: CachedBeaconStateAltair;
  const indices: Map<string, number> = new Map<string, number>();
  let oldBalances: EffectiveBalanceIncrements;
  let newBalances: EffectiveBalanceIncrements;

  const oldRoot = "0x32dec344944029ba183ac387a7aa1f2068591c00e9bfadcfb238e50fbe9ea38e";
  const newRoot = "0xb59f3a209f639dd6b5645ea9fad8d441df44c3be93bd1bbf50ef90bf124d1238";

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});

    const previousEpochParticipationArr = originalState.previousEpochParticipation.getAll();
    const currentEpochParticipationArr = originalState.currentEpochParticipation.getAll();

    const numPreviousEpochParticipation = previousEpochParticipationArr.filter(flagIsTimelySource).length;
    const numCurrentEpochParticipation = currentEpochParticipationArr.filter(flagIsTimelySource).length;

    expect(numPreviousEpochParticipation).to.equal(250000, "Wrong numPreviousEpochParticipation");
    expect(numCurrentEpochParticipation).to.equal(250000, "Wrong numCurrentEpochParticipation");

    oldBalances = getEffectiveBalanceIncrementsZeroed(numPreviousEpochParticipation);
    newBalances = getEffectiveBalanceIncrementsZeroed(numPreviousEpochParticipation);

    for (let i = 0; i < numPreviousEpochParticipation; i++) {
      oldBalances[i] = 32;
      newBalances[i] = 32;
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
      const epoch = originalState.epochCtx.currentShuffling.epoch;
      const committee = originalState.epochCtx.getBeaconCommittee(computeStartSlotAtEpoch(epoch), 0);
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

  itBench({
    id: "computeProposerBoostScoreFromBalances",
    fn: () => {
      computeProposerBoostScoreFromBalances(newBalances, {slotsPerEpoch: 32, proposerScoreBoost: 70});
    },
  });
});
