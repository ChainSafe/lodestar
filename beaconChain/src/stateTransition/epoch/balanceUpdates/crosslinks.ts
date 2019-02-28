import {BeaconState} from "../../../types";

export function processCrosslinksRewards(state: BeaconState): void {
  // Crosslinks
  // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(current_epoch)):
  //
  // Let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot).
  // For every (crosslink_committee, shard) in crosslink_committees_at_slot and every index in crosslink_committee:
  //   If index in attesting_validators(crosslink_committee), state.validator_balances[index] += base_reward(state, index) * total_attesting_balance(crosslink_committee) // get_total_balance(state, crosslink_committee)).
  // If index not in attesting_validators(crosslink_committee), state.validator_balances[index] -= base_reward(state, index).
}
