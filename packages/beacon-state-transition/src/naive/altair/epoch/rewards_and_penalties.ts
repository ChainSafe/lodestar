import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {GENESIS_EPOCH} from "../../../constants";
import {getCurrentEpoch} from "../../../util";
import {decreaseBalance, increaseBalance} from "../../../util/balance";
import {PARTICIPATION_FLAG_WEIGHTS} from "../../../altair/misc";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "../../../altair/state_accessor";

export function processRewardsAndPenalties(config: IBeaconConfig, state: altair.BeaconState): void {
  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = Array.from({length: PARTICIPATION_FLAG_WEIGHTS.length}, (_, flag) =>
    getFlagIndexDeltas(config, state, flag)
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
