import {BeaconState, Crosslink, CrosslinkCommittee, Epoch, Slot} from "../../../types";
import {
  getCrosslinkCommitteesAtSlot, getEpochStartSlot, getTotalBalance,
  slotToEpoch
} from "../../../helpers/stateTransitionHelpers";
import BN = require("bn.js");

export function processCrosslinks(
  state: BeaconState,
  previousEpoch: Epoch,
  nextEpoch: Epoch): void {
  // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(next_epoch)),
  // let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot).
  // For every (crosslink_committee, shard) in crosslink_committees_at_slot, compute:

  // Set state.latest_crosslinks[shard] = Crosslink(epoch=slot_to_epoch(slot), shard_block_root=winning_root(crosslink_committee))
  // if 3 * total_attesting_balance(crosslink_committee) >= 2 * get_total_balance(crosslink_committee).
  const start: number = getEpochStartSlot(previousEpoch).toNumber();
  const end: number = getEpochStartSlot(nextEpoch).toNumber();

  for (let slot: number = start; slot < end; slot++) {
    getCrosslinkCommitteesAtSlot(state, new BN(slot)).map((value: CrosslinkCommittee) => {
      const { shard, validatorIndices } = value;
      const newCrossLink: Crosslink = {epoch: slotToEpoch(new BN(slot)), shardBlockRoot: winningRoot(validatorIndices)};

      if (totalAttestingBalance(validatorIndices).muln(3).gte(getTotalBalance(state, validatorIndices).muln(2))) {
        state.latestCrosslinks[shard.toNumber()] =  newCrossLink;
      }
    });
  }
}
