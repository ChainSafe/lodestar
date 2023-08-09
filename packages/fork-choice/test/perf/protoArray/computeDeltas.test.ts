import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";
import {VoteTracker} from "../../../src/protoArray/interface.js";
import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";
import {computeProposerBoostScoreFromBalances} from "../../../src/forkChoice/forkChoice.js";

describe("computeDeltas", () => {
  const indices: Map<string, number> = new Map<string, number>();
  let oldBalances: EffectiveBalanceIncrements;
  let newBalances: EffectiveBalanceIncrements;

  const oldRoot = "0x32dec344944029ba183ac387a7aa1f2068591c00e9bfadcfb238e50fbe9ea38e";
  const newRoot = "0xb59f3a209f639dd6b5645ea9fad8d441df44c3be93bd1bbf50ef90bf124d1238";
  // 2 first numbers are respective to number of validators in goerli, mainnet as of Aug 2023
  for (const numValidator of [500_000, 750_000, 1_400_000, 2_100_000]) {
    before(function () {
      this.timeout(2 * 60 * 1000);
      oldBalances = getEffectiveBalanceIncrementsZeroed(numValidator);
      newBalances = getEffectiveBalanceIncrementsZeroed(numValidator);

      for (let i = 0; i < numValidator; i++) {
        oldBalances[i] = 32;
        newBalances[i] = 32;
      }
      for (let i = 0; i < 10000; i++) {
        indices.set("" + i, i);
      }
      indices.set(oldRoot, 1001);
      indices.set(newRoot, 1002);
    });

    setBenchOpts({
      minMs: 30 * 1000,
      maxMs: 40 * 1000,
    });

    itBench({
      id: `computeDeltas ${numValidator} validators`,
      beforeEach: () => {
        const votes: VoteTracker[] = [];
        const epoch = 100_000;
        for (let i = 0; i < numValidator; i++) {
          votes.push({
            currentRoot: oldRoot,
            nextRoot: newRoot,
            nextEpoch: epoch,
          });
        }
        return votes;
      },
      fn: (votes) => {
        computeDeltas(indices, votes, oldBalances, newBalances, new Set());
      },
    });

    itBench({
      id: `computeProposerBoostScoreFromBalances ${numValidator} validators`,
      fn: () => {
        computeProposerBoostScoreFromBalances(newBalances, {slotsPerEpoch: 32, proposerScoreBoost: 70});
      },
    });
  }
});
