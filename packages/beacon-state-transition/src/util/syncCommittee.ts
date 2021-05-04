import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, BLSSignature, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bytesToInt, intDiv} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

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

export function isSyncCommitteeAggregator(config: IBeaconConfig, selectionProof: BLSSignature): boolean {
  const {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT, TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE} = config.params;

  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return bytesToInt(hash(selectionProof.valueOf() as Uint8Array).slice(0, 8)) % modulo === 0;
}

export function getSyncSubCommitteePubkeys(
  config: IBeaconConfig,
  state: altair.BeaconState,
  subCommitteeIndex: number
): phase0.BLSPubkey[] {
  const {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} = config.params;
  const syncSubCommitteeSize = intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT);
  const startIndex = subCommitteeIndex * syncSubCommitteeSize;
  return Array.from({length: syncSubCommitteeSize}, (_, i) => state.currentSyncCommittee.pubkeys[i + startIndex]);
}
