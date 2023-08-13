import crypto from "node:crypto";
import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {toHexString} from "@chainsafe/ssz";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";
import {VoteTracker} from "../../../src/protoArray/interface.js";
import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";
import {computeProposerBoostScoreFromBalances} from "../../../src/forkChoice/forkChoice.js";

describe("computeDeltas", () => {
  let oldBalances: EffectiveBalanceIncrements;
  let newBalances: EffectiveBalanceIncrements;

  const oldRoot = "0x32dec344944029ba183ac387a7aa1f2068591c00e9bfadcfb238e50fbe9ea38e";
  const newRoot = "0xb59f3a209f639dd6b5645ea9fad8d441df44c3be93bd1bbf50ef90bf124d1238";
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
      const indices: Map<string, number> = new Map<string, number>();
      for (let i = 0; i < numProtoNode; i++) {
        indices.set(toHexString(crypto.randomBytes(32)), i);
      }
      indices.set(oldRoot, Math.floor(numProtoNode / 2));
      indices.set(newRoot, Math.floor(numProtoNode / 2) + 1);
      itBench({
        id: `computeDeltas ${numValidator} validators ${numProtoNode} proto nodes`,
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
