import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";

export function computeSyncCommitteePeriod(config: IBeaconConfig, epoch: phase0.Epoch): number {
  return intDiv(epoch, config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}

/**
 * Return subnets based on index of validator in sync committee.
 * @returns
 */
export function computeSubnetsForSyncCommittee(
  config: IBeaconConfig,
  state: altair.BeaconState,
  validatorIndex: ValidatorIndex
): number[] {
  const targetPubkey = state.validators[validatorIndex].pubkey;
  const syncCommitteeIndices: number[] = [];
  let index = 0;
  for (const pubkey of state.currentSyncCommittee.pubkeys) {
    if (config.types.phase0.BLSSignature.equals(pubkey, targetPubkey)) {
      syncCommitteeIndices.push(index);
    }
    index++;
  }
  return syncCommitteeIndices.map((index) =>
    intDiv(intDiv(index, config.params.SYNC_COMMITTEE_SIZE), config.params.SYNC_COMMITTEE_SUBNET_COUNT)
  );
}
