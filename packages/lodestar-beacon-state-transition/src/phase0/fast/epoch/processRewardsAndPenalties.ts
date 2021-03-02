import {phase0} from "@chainsafe/lodestar-types";
import {readOnlyMap, List} from "@chainsafe/ssz";

import {GENESIS_EPOCH} from "../../../constants";
import {EpochContext, IEpochProcess} from "../util";
import {getAttestationDeltas} from "./getAttestationDeltas";

export function processRewardsAndPenalties(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: phase0.BeaconState
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (process.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(epochCtx, process, state);
  const newBalances = readOnlyMap(state.balances, (balance, i) => {
    const newBalance = balance + BigInt(rewards[i] - penalties[i]);
    return newBalance < 0 ? BigInt(0) : newBalance;
  });

  process.balances = newBalances;
  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  state.balances = newBalances as List<bigint>;
}
