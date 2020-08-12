import {BeaconState} from "@chainsafe/lodestar-types";
import {readOnlyMap, List} from "@chainsafe/ssz";

import {GENESIS_EPOCH} from "../../constants";
import {EpochContext, IEpochProcess} from "../util";
import {getAttestationDeltas} from "./getAttestationDeltas";


export function processRewardsAndPenalties(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): void {
  if (process.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(epochCtx, process, state);
  const newBalances = readOnlyMap(state.balances, (balance) => balance);

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
  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  state.balances = newBalances as List<bigint>;
}
