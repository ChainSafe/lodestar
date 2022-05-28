import {EffectiveBalanceIncrements} from "@chainsafe/lodestar-beacon-state-transition";
import {IVoteTracker, HEX_ZERO_HASH} from "./interface.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "./errors.js";

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
  indices: Map<string, number>,
  votes: IVoteTracker[],
  oldBalances: EffectiveBalanceIncrements,
  newBalances: EffectiveBalanceIncrements
): number[] {
  const deltas = Array.from({length: indices.size}, () => 0);
  const zeroHash = HEX_ZERO_HASH;
  for (let vIndex = 0; vIndex < votes.length; vIndex++) {
    const vote = votes[vIndex];
    // There is no need to create a score change if the validator has never voted or both of their
    // votes are for the zero hash (genesis block)
    if (vote === undefined) {
      continue;
    }
    const {currentRoot, nextRoot} = vote;
    if (currentRoot === zeroHash && nextRoot === zeroHash) {
      continue;
    }

    // IF the validator was not included in the _old_ balances (i.e. it did not exist yet)
    // then say its balance was 0
    const oldBalance = oldBalances[vIndex] || 0;

    // If the validator's vote is not known in the _new_ balances, then use a balance of zero.
    //
    // It is possible that there was a vote for an unknown validator if we change our justified
    // state to a new state with a higher epoch that is on a different fork because that fork may have
    // on-boarded fewer validators than the prior fork.
    const newBalance = newBalances[vIndex] || 0;

    if (currentRoot !== nextRoot || oldBalance !== newBalance) {
      // We ignore the vote if it is not known in `indices .
      // We assume that it is outside of our tree (ie: pre-finalization) and therefore not interesting
      const currentDeltaIndex = indices.get(currentRoot);
      if (currentDeltaIndex !== undefined) {
        if (currentDeltaIndex >= deltas.length) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_NODE_DELTA,
            index: currentDeltaIndex,
          });
        }
        deltas[currentDeltaIndex] -= oldBalance;
      }
      // We ignore the vote if it is not known in `indices .
      // We assume that it is outside of our tree (ie: pre-finalization) and therefore not interesting
      const nextDeltaIndex = indices.get(nextRoot);
      if (nextDeltaIndex !== undefined) {
        if (nextDeltaIndex >= deltas.length) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_NODE_DELTA,
            index: nextDeltaIndex,
          });
        }
        deltas[nextDeltaIndex] += newBalance;
      }
    }
    vote.currentRoot = nextRoot;
  }

  return deltas;
}
