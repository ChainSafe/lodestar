import {BeaconState, Crosslink, CrosslinkCommittee, Epoch, PendingAttestation, Slot} from "../../../types";
import {
  getCrosslinkCommitteesAtSlot, getEpochStartSlot, getTotalBalance,
  slotToEpoch
} from "../../helpers/stateTransitionHelpers";
import BN from "bn.js";
import {winningRoot} from "./helpers";

export function processCrosslinks(
  state: BeaconState,
  previousEpoch: Epoch,
  nextEpoch: Epoch,
  previousEpochAttestations: PendingAttestation[],
  currentEpochAttestations: PendingAttestation[]): void {

  const start = getEpochStartSlot(previousEpoch);
  const end = getEpochStartSlot(nextEpoch);
  for (let slot = start; slot < end; slot++) {
    getCrosslinkCommitteesAtSlot(state, slot).map((value: CrosslinkCommittee) => {
      const { shard, validatorIndices } = value;
      // TODO Complete totalAttestingBalance to complete below
      // const newCrossLink: Crosslink = {
      //   epoch: slotToEpoch(new BN(slot)),
      //   shardBlockRoot: winningRoot(state, shard, previousEpochAttestations, currentEpochAttestations, validatorIndices)
      // };

      // if (totalAttestingBalance(validatorIndices).muln(3).gte(getTotalBalance(state, validatorIndices).muln(2))) {
      //   state.latestCrosslinks[shard.toNumber()] =  newCrossLink;
      // }
    });
  }
}
