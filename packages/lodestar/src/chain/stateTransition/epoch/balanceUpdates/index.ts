/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../../types";
import {GENESIS_EPOCH} from "../../../../constants";
import {IBeaconConfig} from "../../../../config";
import {getCurrentEpoch, increaseBalance, decreaseBalance} from "../../util";
import {getAttestationDeltas} from "./attestation";
import {getCrosslinkDeltas} from "./crosslink";

export function processRewardsAndPenalties(config: IBeaconConfig, state: BeaconState): void {
  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }
  const [rewards1, penalties1] = getAttestationDeltas(config, state);
  const [rewards2, penalties2] = getCrosslinkDeltas(config, state);
  state.validatorRegistry.forEach((_, index) => {
    increaseBalance(state, index, rewards1[index].add(rewards2[index]));
    decreaseBalance(state, index, penalties1[index].add(penalties2[index]));
  });
}
