import {phase0} from "@chainsafe/lodestar-types";

import {GENESIS_EPOCH} from "../../../constants";
import {CachedBeaconState, IEpochProcess} from "../../../fast/util";
import {getAttestationDeltas} from "./getAttestationDeltas";

export function processRewardsAndPenalties(state: CachedBeaconState<phase0.BeaconState>, process: IEpochProcess): void {
  const {balances} = state;
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (process.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(state, process);
  const newBalances = new BigUint64Array(balances.length);
  balances.forEach((balance, i) => {
    const newBalance = balance + BigInt(rewards[i] - penalties[i]);
    if (newBalance > 0) {
      newBalances[i] = newBalance;
    }
  });

  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  balances.updateAll(newBalances);
  // cache the balances array, too
  process.balances = newBalances;
}
