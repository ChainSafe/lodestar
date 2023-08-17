import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";
import {VoteTracker} from "../../../src/protoArray/interface.js";
import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";
import {computeProposerBoostScoreFromBalances} from "../../../src/forkChoice/forkChoice.js";

describe("computeDeltas", () => {
  let oldBalances: EffectiveBalanceIncrements;
  let newBalances: EffectiveBalanceIncrements;

  const oneHourProtoNodes = (60 * 60) / 12;
  const fourHourProtoNodes = 4 * oneHourProtoNodes;
  const oneDayProtoNodes = 24 * oneHourProtoNodes;
  // 2 first numbers are respective to number of validators in goerli, mainnet as of Aug 2023
  const numValidators = [500_000, 750_000, 1_400_000, 2_100_000];
  for (const numValidator of numValidators) {
    before(function () {
      this.timeout(2 * 60 * 1000);
      oldBalances = getEffectiveBalanceIncrementsZeroed(numValidator);
      newBalances = getEffectiveBalanceIncrementsZeroed(numValidator);

      for (let i = 0; i < numValidator; i++) {
        oldBalances[i] = 32;
        newBalances[i] = 32;
      }
    });

    setBenchOpts({
      minMs: 30 * 1000,
      maxMs: 40 * 1000,
    });

    for (const numProtoNode of [oneHourProtoNodes, fourHourProtoNodes, oneDayProtoNodes]) {
      itBench({
        id: `computeDeltas ${numValidator} validators ${numProtoNode} proto nodes`,
        beforeEach: () => {
          const votes: VoteTracker[] = [];
          const epoch = 100_000;
          for (let i = 0; i < numValidator; i++) {
            votes.push({
              currentIndex: Math.floor(numProtoNode / 2),
              nextIndex: Math.floor(numProtoNode / 2) + 1,
              nextEpoch: epoch,
            });
          }
          return votes;
        },
        fn: (votes) => {
          computeDeltas(numProtoNode, votes, oldBalances, newBalances, new Set());
        },
      });
    }
  }

  for (const numValidator of numValidators) {
    itBench({
      id: `computeProposerBoostScoreFromBalances ${numValidator} validators`,
      fn: () => {
        computeProposerBoostScoreFromBalances(newBalances, {slotsPerEpoch: 32, proposerScoreBoost: 70});
      },
    });
  }
});
