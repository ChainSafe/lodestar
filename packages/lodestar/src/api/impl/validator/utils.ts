import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeSyncCommitteePeriod,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {allForks, altair, CommitteeIndex, Epoch, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ApiError} from "../errors";

export function getSyncComitteeValidatorIndexMap(
  config: IBeaconConfig,
  state: allForks.BeaconState | CachedBeaconState<allForks.BeaconState>,
  requestedEpoch: Epoch
): Map<ValidatorIndex, number[]> {
  const statePeriod = computeSyncCommitteePeriod(config, computeEpochAtSlot(config, state.slot));
  const requestPeriod = computeSyncCommitteePeriod(config, requestedEpoch);

  if ((state as CachedBeaconState<allForks.BeaconState>).epochCtx) {
    switch (requestPeriod) {
      case statePeriod:
        return (state as CachedBeaconState<altair.BeaconState>).currSyncComitteeValidatorIndexMap;
      case statePeriod + 1:
        return (state as CachedBeaconState<altair.BeaconState>).nextSyncComitteeValidatorIndexMap;
      default:
        throw new ApiError(400, "Epoch out of bounds");
    }
  }

  throw new ApiError(400, "No CachedBeaconState available");
}

export function computeSubnetForCommitteesAtSlot(
  config: IBeaconConfig,
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(config, slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
