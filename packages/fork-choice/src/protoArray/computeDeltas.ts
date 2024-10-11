import {ValidatorIndex} from "@lodestar/types";
import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {VoteTracker} from "./interface.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "./errors.js";

// reuse arrays to avoid memory reallocation and gc
const deltas = new Array<number>();

/**
 * Returns a list of `deltas`, where there is one delta for each of the indices in `indices`
 *
 * The deltas are formed by a change between `oldBalances` and `newBalances`, and/or a change of vote in `votes`.
 *
 * ## Errors
 *
 * - If a value in `indices` is greater to or equal to `indices.length`.
 */
export function computeDeltas(
  numProtoNodes: number,
  votes: VoteTracker[],
  oldBalances: EffectiveBalanceIncrements,
  newBalances: EffectiveBalanceIncrements,
  equivocatingIndices: Set<ValidatorIndex>
): number[] {
  deltas.length = numProtoNodes;
  deltas.fill(0);

  // avoid creating new variables in the loop to potentially reduce GC pressure
  let oldBalance, newBalance: number;
  let currentIndex, nextIndex: number | null;

  for (let vIndex = 0; vIndex < votes.length; vIndex++) {
    const vote = votes[vIndex];
    // There is no need to create a score change if the validator has never voted or both of their
    // votes are for the zero hash (genesis block)
    if (vote === undefined) {
      continue;
    }
    currentIndex = vote.currentIndex;
    nextIndex = vote.nextIndex;

    // IF the validator was not included in the _old_ balances (i.e. it did not exist yet)
    // then say its balance was 0
    oldBalance = oldBalances[vIndex] ?? 0;

    // If the validator's vote is not known in the _new_ balances, then use a balance of zero.
    //
    // It is possible that there was a vote for an unknown validator if we change our justified
    // state to a new state with a higher epoch that is on a different fork because that fork may have
    // on-boarded fewer validators than the prior fork.
    newBalance = newBalances === oldBalances ? oldBalance : (newBalances[vIndex] ?? 0);

    if (equivocatingIndices.size > 0 && equivocatingIndices.has(vIndex)) {
      // this function could be called multiple times but we only want to process slashing validator for 1 time
      if (currentIndex !== null) {
        if (currentIndex >= numProtoNodes) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_NODE_DELTA,
            index: currentIndex,
          });
        }
        deltas[currentIndex] -= oldBalance;
      }
      vote.currentIndex = null;
      continue;
    }

    if (currentIndex !== nextIndex || oldBalance !== newBalance) {
      // We ignore the vote if it is not known in `indices .
      // We assume that it is outside of our tree (ie: pre-finalization) and therefore not interesting
      if (currentIndex !== null) {
        if (currentIndex >= numProtoNodes) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_NODE_DELTA,
            index: currentIndex,
          });
        }
        deltas[currentIndex] -= oldBalance;
      }

      // We ignore the vote if it is not known in `indices .
      // We assume that it is outside of our tree (ie: pre-finalization) and therefore not interesting
      if (nextIndex !== null) {
        if (nextIndex >= numProtoNodes) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_NODE_DELTA,
            index: nextIndex,
          });
        }
        deltas[nextIndex] += newBalance;
      }
    }
    vote.currentIndex = nextIndex;
  }

  return deltas;
}
