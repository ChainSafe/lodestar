/**
 * @module chain/stateTransition/epoch
 */

import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

import {getCurrentEpoch, increaseBalance, decreaseBalance} from "../../../../util";
import {getAttestationDeltas} from "./attestation";

export * from "./attestation";
export * from "./util";

export function processRewardsAndPenalties(state: phase0.BeaconState): void {
  if (getCurrentEpoch(state) == GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(state);
  const validatorsLength = state.validators.length;
  for (let index = 0; index < validatorsLength; index++) {
    increaseBalance(state, index, rewards[index]);
    decreaseBalance(state, index, penalties[index]);
  }
}
