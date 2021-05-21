import {altair} from "@chainsafe/lodestar-types";
import {GENESIS_EPOCH} from "../../constants";
import {getCurrentEpoch} from "../../util";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {PARTICIPATION_FLAG_WEIGHTS} from "../misc";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "./balance";

export function processRewardsAndPenalties(state: CachedBeaconState<altair.BeaconState>, process: IEpochProcess): void {
  const {balances, config} = state;

  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = Array.from({length: PARTICIPATION_FLAG_WEIGHTS.length}, (_, flag) =>
    getFlagIndexDeltas(state, process, flag)
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
