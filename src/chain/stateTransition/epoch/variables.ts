import BN from "bn.js";
import {
  getActiveValidatorIndices, getAttestationParticipants,
  getBlockRoot, getCrosslinkCommitteesAtSlot, getCurrentEpoch, getEpochStartSlot, getPreviousEpoch, getTotalBalance,
  slotToEpoch
} from "../../helpers/stateTransitionHelpers";
import {
  Attestation, BeaconState, CrosslinkCommittee, Epoch, Gwei, PendingAttestation,
  ValidatorIndex
} from "../../../types";

export function processVariables(state: BeaconState) {
  // Variables
  const currentEpoch: Epoch = getCurrentEpoch(state);
  const previousEpoch: Epoch = getPreviousEpoch(state);
  const nextEpoch: Epoch = currentEpoch + 1;

  // Validators attesting during the current epoch
  const currentTotalBalance: Gwei = getTotalBalance(state, getActiveValidatorIndices(state.validatorRegistry, currentEpoch));
  const currentEpochAttestations: PendingAttestation[] = state.latestAttestations.filter((attestation) => currentEpoch === slotToEpoch(attestation.data.slot));

  // Validators justifying the epoch boundary block at the start of the current epoch
  const currentEpochBoundaryAttestations: PendingAttestation[] = currentEpochAttestations.filter((attestation: PendingAttestation) => {
    attestation.data.epochBoundaryRoot.equals(getBlockRoot(state, getEpochStartSlot(currentEpoch)));
  });

  const currentEpochBoundaryAttesterIndices: ValidatorIndex[] = [
    ...new Set(
      currentEpochBoundaryAttestations.flatMap((a: PendingAttestation) =>
        getAttestationParticipants(state, a.data, a.aggregationBitfield)))
  ];

  const currentEpochBoundaryAttestingBalance = getTotalBalance(state, currentEpochBoundaryAttesterIndices);

  // Validators attesting during the previous epoch
  const previousTotalBalance: Gwei = getTotalBalance(state, getActiveValidatorIndices(state.validatorRegistry, previousEpoch));

  // Validators that made an attestation during the previous epoch, targeting the previous justified slot
  const previousEpochAttestations: PendingAttestation[] = state.latestAttestations.filter((attestation) =>
    previousEpoch === slotToEpoch(attestation.data.slot));

  // const previousEpochAttesterIndices: ValidatorIndex[] = previousEpochAttestations
  //   .map((attestation: PendingAttestation) => getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield))
  //   .reduce((previousValue: ValidatorIndex[], currentValue: ValidatorIndex[]) => previousValue.concat(...currentValue));
  const previousEpochAttesterIndices: ValidatorIndex[] = [
    ...new Set(
      previousEpochAttestations.flatMap((a: PendingAttestation) => getAttestationParticipants(state, a.data, a.aggregationBitfield))
    )
  ];

  const previousEpochAttestingBalance: Gwei = getTotalBalance(state, previousEpochAttesterIndices);

  // Validators justifying the epoch boundary block at the start of the previous epoch
  const previousEpochBoundaryAttestations: PendingAttestation[] = previousEpochAttestations.filter((attestation) => {
    attestation.data.epochBoundaryRoot.equals(getBlockRoot(state, getEpochStartSlot(previousEpoch)));
  });

  const previousEpochBoundaryAttesterIndices: ValidatorIndex[] = [
    ...new Set(
      previousEpochBoundaryAttestations.flatMap((a: PendingAttestation) => getAttestationParticipants(state, a.data, a.aggregationBitfield))
    )
  ];

  const previousEpochBoundaryAttestingBalance: Gwei = getTotalBalance(state, previousEpochBoundaryAttesterIndices);

  // Validators attesting to the expected beacon chain head during the previous epoch
  const previousEpochHeadAttestations: PendingAttestation[] = previousEpochAttestations.filter((attestation) => {
    attestation.data.beaconBlockRoot.equals(getBlockRoot(state, attestation.data.slot));
  });

  const previousEpochHeadAttesterIndices: ValidatorIndex[] = [
    ...new Set(
      previousEpochAttestations.flatMap((a: PendingAttestation) => getAttestationParticipants(state, a.data, a.aggregationBitfield))
    )
  ];

  const previousEpochHeadAttestingBalance: Gwei = getTotalBalance(state, previousEpochHeadAttesterIndices);

  // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(next_epoch)), let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot). For every (crosslink_committee, shard) in crosslink_committees_at_slot, compute:
  //
  // Let shard_block_root be state.latest_crosslinks[shard].shard_block_root
  // Let total_attesting_balance(crosslink_committee) = get_total_balance(state, attesting_validators(crosslink_committee)).
  // TODO Need to finish
  const startSlot = getEpochStartSlot(previousEpoch);
  const endSlot = getEpochStartSlot(nextEpoch);
  for (let slot = startSlot; slot < endSlot; slot++) {
    const crosslinkCommitteesAtSlot = getCrosslinkCommitteesAtSlot(state, slot).map((value: CrosslinkCommittee) => {
      const { shard, validatorIndices } = value;
      const shardBlockRoot = state.latestCrosslinks[shard];

    })
  }

  return {
    currentEpoch,
    previousEpoch,
    nextEpoch,
    currentTotalBalance,
    currentEpochAttestations,
    currentEpochBoundaryAttesterIndices,
    currentEpochBoundaryAttestingBalance,
    previousTotalBalance,
    previousEpochAttestations,
    previousEpochAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestations,
    previousEpochBoundaryAttesterIndices,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestations,
    previousEpochHeadAttesterIndices,
    previousEpochHeadAttestingBalance,
  }
}
