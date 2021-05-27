import {altair} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../util";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {getFlagIndicesAndWeights} from "../misc";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "./balance";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";

export function processRewardsAndPenalties(state: CachedBeaconState<altair.BeaconState>, process: IEpochProcess): void {
  const {balances} = state;

  if (getCurrentEpoch(state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = getFlagIndicesAndWeights().map(([flag, numerator]) =>
    getFlagIndexDeltas(state, process, flag, numerator)
  );
  const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(state, process);
  flagDeltas.push(inactivityPenaltyDeltas);

  const newBalances = new BigUint64Array(balances.length);
  balances.forEach((balance, i) => {
    let newBalance = balance;
    for (const [rewards, penalties] of flagDeltas) {
      const b = newBalance + BigInt(rewards[i] - penalties[i]);
      if (b > 0) {
        newBalance = b;
      } else {
        newBalance = BigInt(0);
      }
    }
    newBalances[i] = newBalance;
  });

  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  balances.updateAll(newBalances);
  // cache the balances array, too
  process.balances = newBalances;
}
