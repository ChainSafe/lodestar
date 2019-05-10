/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../../types";
import {GENESIS_EPOCH} from "../../../../constants";
import {getCurrentEpoch, increaseBalance, decreaseBalance} from "../../util";
import {getAttestationDeltas} from "./attestation";
import {getCrosslinkDeltas} from "./crosslink";

export function processRewardsAndPenalties(state: BeaconState): void {
  if (getCurrentEpoch(state) == GENESIS_EPOCH) {
    return;
  }
  const [rewards1, penalties1] = getAttestationDeltas(state);
  const [rewards2, penalties2] = getCrosslinkDeltas(state);
  state.validatorRegistry.forEach((_, index) => {
    increaseBalance(state, index, rewards1[index].add(rewards2[index]));
    decreaseBalance(state, index, penalties1[index].add(penalties2[index]));
  });
}
