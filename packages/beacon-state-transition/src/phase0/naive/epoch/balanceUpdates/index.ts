/**
 * @module chain/stateTransition/epoch
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {GENESIS_EPOCH} from "../../../../constants";
import {getCurrentEpoch, increaseBalance, decreaseBalance} from "../../../../util";
import {getAttestationDeltas} from "./attestation";

export * from "./attestation";
export * from "./util";

export function processRewardsAndPenalties(config: IBeaconConfig, state: phase0.BeaconState): void {
  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(config, state);
  const validatorsLength = state.validators.length;
  for (let index = 0; index < validatorsLength; index++) {
    increaseBalance(state, index, rewards[index]);
    decreaseBalance(state, index, penalties[index]);
  }
}
