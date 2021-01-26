import {readOnlyMap, List} from "@chainsafe/ssz";

import {GENESIS_EPOCH} from "../../constants";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {IEpochProcess} from "../util/epochProcess";
import {getAttestationDeltas} from "./getAttestationDeltas";

export function processRewardsAndPenalties(cachedState: CachedBeaconState, process: IEpochProcess): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (process.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(cachedState, process);
  const newBalances = readOnlyMap(cachedState.balances, (balance) => balance);

  rewards.forEach((reward, i) => {
    newBalances[i] += reward;
  });

  penalties.forEach((penalty, i) => {
    if (penalty > newBalances[i]) {
      newBalances[i] = BigInt(0);
    } else {
      newBalances[i] -= penalty;
    }
  });
  process.balances = newBalances;
  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  cachedState.balances = newBalances as List<bigint>;
}
