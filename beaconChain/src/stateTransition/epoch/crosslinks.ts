import {BeaconState} from "../../../types";

export function processCrosslinks(state: BeaconState): void {
  // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(next_epoch)), let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot). For every (crosslink_committee, shard) in crosslink_committees_at_slot, compute:
  //
  // Set state.latest_crosslinks[shard] = Crosslink(epoch=slot_to_epoch(slot), shard_block_root=winning_root(crosslink_committee)) if 3 * total_attesting_balance(crosslink_committee) >= 2 * get_total_balance(crosslink_committee).
}
