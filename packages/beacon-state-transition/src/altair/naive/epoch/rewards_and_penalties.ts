import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {GENESIS_EPOCH} from "../../../constants";
import {getCurrentEpoch} from "../../../util";
import {decreaseBalance, increaseBalance} from "../../../util/balance";
import {getFlagIndicesAndWeights} from "../../misc";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "../../state_accessor";

export function processRewardsAndPenalties(config: IBeaconConfig, state: altair.BeaconState): void {
  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = getFlagIndicesAndWeights().map(([flag, numerator]) =>
    getFlagIndexDeltas(config, state, flag, numerator)
  );
  const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(config, state);
  flagDeltas.push(inactivityPenaltyDeltas);
  for (const [rewards, penalties] of flagDeltas) {
    for (let index = 0; index < state.validators.length; index++) {
      increaseBalance(state, index, rewards[index]);
      decreaseBalance(state, index, penalties[index]);
    }
  }
}
