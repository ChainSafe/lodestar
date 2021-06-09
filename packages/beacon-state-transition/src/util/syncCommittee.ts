import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
  TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE,
} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {ssz} from "@chainsafe/lodestar-types";
import {BLSSignature, phase0} from "@chainsafe/lodestar-types";
import {bytesToInt, intDiv} from "@chainsafe/lodestar-utils";
import {BitList, hash, isTreeBacked, TreeBacked} from "@chainsafe/ssz";
import {zipIndexesInBitList} from "./aggregationBits";

/**
 * TODO
 * This is a naive implementation of SyncCommittee utilities.
 * We should cache syncCommitteeIndices in CachedBeaconState to make it faster.
 * */

export function computeSyncCommitteePeriod(epoch: phase0.Epoch): number {
  return intDiv(epoch, EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}

export function isSyncCommitteeAggregator(selectionProof: BLSSignature): boolean {
  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return bytesToInt(hash(selectionProof.valueOf() as Uint8Array).slice(0, 8)) % modulo === 0;
}

export function extractParticipantIndices(
  committeeIndices: phase0.ValidatorIndex[],
  syncAggregate: altair.SyncAggregate
): phase0.ValidatorIndex[] {
  if (isTreeBacked(syncAggregate)) {
    return zipIndexesInBitList(
      committeeIndices,
      syncAggregate.syncCommitteeBits as TreeBacked<BitList>,
      ssz.altair.SyncCommitteeBits
    );
  } else {
    const participantIndices = [];
    for (const [i, index] of committeeIndices.entries()) {
      if (syncAggregate.syncCommitteeBits[i]) {
        participantIndices.push(index);
      }
    }
    return participantIndices;
  }
}
