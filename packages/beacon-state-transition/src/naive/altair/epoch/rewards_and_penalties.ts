import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../../util";
import {decreaseBalance, increaseBalance} from "../../../util/balance";
import {getFlagIndicesAndWeights} from "../../../altair/misc";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "../../../altair/state_accessor";

export function processRewardsAndPenalties(config: IBeaconConfig, state: altair.BeaconState): void {
  if (getCurrentEpoch(state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = getFlagIndicesAndWeights().map(([flag, numerator]) => getFlagIndexDeltas(state, flag, numerator));
  const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(config, state);
  flagDeltas.push(inactivityPenaltyDeltas);
  for (const [rewards, penalties] of flagDeltas) {
    for (let index = 0; index < state.validators.length; index++) {
      increaseBalance(state, index, rewards[index]);
      decreaseBalance(state, index, penalties[index]);
    }
  }
}
