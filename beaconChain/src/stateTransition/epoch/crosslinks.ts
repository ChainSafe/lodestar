import {BeaconState, Crosslink, CrosslinkCommittee, Epoch, Slot} from "../../types";
import {
  getCrosslinkCommitteesAtSlot, getEpochStartSlot, getTotalBalance,
  slotToEpoch
} from "../../helpers/stateTransitionHelpers";
import BN = require("bn.js");

export function processCrosslinks(
  state: BeaconState,
  previousEpoch: Epoch,
  nextEpoch: Epoch): void {

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
