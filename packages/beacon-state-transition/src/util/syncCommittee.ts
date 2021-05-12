import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {BLSSignature, phase0} from "@chainsafe/lodestar-types";
import {bytesToInt, intDiv} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

/**
 * TODO
 * This is a naive implementation of SyncCommittee utilities.
 * We should cache syncCommitteeIndices in CachedBeaconState to make it faster.
 * */

export function computeSyncCommitteePeriod(config: IBeaconConfig, epoch: phase0.Epoch): number {
  return intDiv(epoch, config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}

export function isSyncCommitteeAggregator(config: IBeaconConfig, selectionProof: BLSSignature): boolean {
  const {SYNC_COMMITTEE_SIZE, TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE} = config.params;

  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return bytesToInt(hash(selectionProof.valueOf() as Uint8Array).slice(0, 8)) % modulo === 0;
}
