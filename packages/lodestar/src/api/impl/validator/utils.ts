import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeSyncPeriodAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {allForks, altair, BLSPubkey, CommitteeIndex, Epoch, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ApiError} from "../errors";

export function getSyncComitteeValidatorIndexMap(
  state: allForks.BeaconState | CachedBeaconState<allForks.BeaconState>,
  requestedEpoch: Epoch
): Map<ValidatorIndex, number[]> {
  const statePeriod = computeSyncPeriodAtEpoch(computeEpochAtSlot(state.slot));
  const requestPeriod = computeSyncPeriodAtEpoch(requestedEpoch);

  if ((state as CachedBeaconState<allForks.BeaconState>).epochCtx) {
    switch (requestPeriod) {
      case statePeriod:
        return (state as CachedBeaconState<altair.BeaconState>).currentSyncCommittee.validatorIndexMap;
      case statePeriod + 1:
        return (state as CachedBeaconState<altair.BeaconState>).nextSyncCommittee.validatorIndexMap;
      default:
        throw new ApiError(400, "Epoch out of bounds");
    }
  }

  throw new ApiError(400, "No CachedBeaconState available");
}

export function computeSubnetForCommitteesAtSlot(
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}

/**
 * Precompute all pubkeys for given `validatorIndices`. Ensures that all `validatorIndices` are known
 * before doing other expensive logic.
 *
 * Note: Using a MutableVector is the fastest way of getting compressed pubkeys.
 *       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
 */
export function getPubkeysForIndices(
  state: CachedBeaconState<allForks.BeaconState>,
  validatorIndices: ValidatorIndex[]
): (validatorIndex: ValidatorIndex) => BLSPubkey {
  const validators = state.validators; // Get the validators sub tree once for all the loop
  const pubkeyMap = new Map(
    validatorIndices.map((validatorIndex) => {
      const validator = validators[validatorIndex];
      if (!validator) throw new ApiError(400, `Validator index ${validatorIndex} not in state`);
      return [validatorIndex, validator.pubkey];
    })
  );

  return function getPubkey(validatorIndex: ValidatorIndex) {
    const pubkey = pubkeyMap.get(validatorIndex);
    if (!pubkey) throw Error(`Unknown validatorIndex ${validatorIndex}`);
    return pubkey;
  };
}
