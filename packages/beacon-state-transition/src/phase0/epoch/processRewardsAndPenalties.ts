import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {getAttestationDeltas} from "./getAttestationDeltas";

export function processRewardsAndPenalties(
  state: CachedBeaconState<phase0.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const {balances} = state;
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (epochProcess.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(state, epochProcess);
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
  epochProcess.balances = newBalances;
}
