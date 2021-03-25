import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";
import {GENESIS_EPOCH, getCurrentEpoch} from "../../..";
import {decreaseBalance, increaseBalance} from "../../../util/balance";
import {getFlagsAndNumerators} from "../../misc";
import {getFlagDeltas, getInactivityPenaltyDeltas} from "./balance_utils";

export function processRewardsAndPenalties(config: IBeaconConfig, state: lightclient.BeaconState): void {
  if (getCurrentEpoch(config, state) == GENESIS_EPOCH) {
    return;
  }

  const flagDeltas = getFlagsAndNumerators().map(([flag, numerator]) => getFlagDeltas(config, state, flag, numerator));
  const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(config, state);
  flagDeltas.push(inactivityPenaltyDeltas);
  for (const [rewards, penalties] of flagDeltas) {
    for (let vIndex = 0; vIndex < state.validators.length; vIndex++) {
      increaseBalance(state, vIndex, rewards[vIndex]);
      decreaseBalance(state, vIndex, penalties[vIndex]);
    }
  }
}
