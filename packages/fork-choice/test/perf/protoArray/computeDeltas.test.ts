import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";
import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";
import {NULL_VOTE_INDEX} from "../../../src/protoArray/interface.js";

describe("computeDeltas", () => {
  let oldBalances: EffectiveBalanceIncrements;
  let newBalances: EffectiveBalanceIncrements;

  // it's not much differences between 1h vs 4h or even 1d proto nodes
  const numProtoNode = (60 * 60) / 12;
  const inactiveValidatorsPercentages = [0, 0.1, 0.2, 0.5];

  const numValidators = [1_400_000, 2_100_000];
  for (const numValidator of numValidators) {
    beforeAll(
      () => {
        oldBalances = getEffectiveBalanceIncrementsZeroed(numValidator);
        newBalances = getEffectiveBalanceIncrementsZeroed(numValidator);

        for (let i = 0; i < numValidator; i++) {
          oldBalances[i] = 32;
          newBalances[i] = 32;
        }
      },
      2 * 60 * 1000
    );

    for (const inainactiveValidatorsPercentage of inactiveValidatorsPercentages) {
      if (inainactiveValidatorsPercentage < 0 || inainactiveValidatorsPercentage > 1) {
        throw new Error("inactiveValidatorsPercentage must be between 0 and 1");
      }
      // this results in [null, 10, 5, 2], ie for 10% inactive validators, every validator index ending with 0 is inactive
      const inactiveValidatorMod =
        inainactiveValidatorsPercentage === 0 ? null : Math.floor(1 / inainactiveValidatorsPercentage);
      const voteCurrentIndices = Array.from({length: numValidator}, () => NULL_VOTE_INDEX);
      const voteNextIndices = Array.from({length: numValidator}, () => NULL_VOTE_INDEX);
      bench({
        id: `computeDeltas ${numValidator} validators ${inainactiveValidatorsPercentage * 100}% inactive`,
        beforeEach: () => {
          for (let i = 0; i < numValidator; i++) {
            if (inactiveValidatorMod != null && i % inactiveValidatorMod === 0) continue;
            voteCurrentIndices[i] = Math.floor(numProtoNode / 2);
            voteNextIndices[i] = Math.floor(numProtoNode / 2) + 1;
          }
          return {voteCurrentIndices, voteNextIndices};
        },
        fn: ({voteCurrentIndices, voteNextIndices}) => {
          computeDeltas(
            numProtoNode,
            voteCurrentIndices,
            voteNextIndices,
            oldBalances,
            newBalances,
            new Set([1, 2, 3, 4, 5])
          );
        },
      });
    }
  }
});
