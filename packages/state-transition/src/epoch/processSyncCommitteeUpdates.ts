import {aggregateSerializedPublicKeys} from "@chainsafe/blst";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getNextSyncCommitteeIndices} from "../util/seed.js";
import {CachedBeaconStateAltair} from "../types.js";

/**
 * Rotate nextSyncCommittee to currentSyncCommittee if sync committee period is over.
 *
 * PERF: Once every `EPOCHS_PER_SYNC_COMMITTEE_PERIOD`, do an expensive operation to compute the next committee.
 * Calculating the next sync committee has a proportional cost to $VALIDATOR_COUNT
 */
export function processSyncCommitteeUpdates(fork: ForkSeq, state: CachedBeaconStateAltair): void {
  const nextEpoch = state.epochCtx.epoch + 1;

  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    const activeValidatorIndices = state.epochCtx.nextActiveIndices;
    const {effectiveBalanceIncrements} = state.epochCtx;

    const nextSyncCommitteeIndices = getNextSyncCommitteeIndices(
      fork,
      state,
      activeValidatorIndices,
      effectiveBalanceIncrements
    );
    const validators = state.validators;

    // Using the index2pubkey cache is slower because it needs the serialized pubkey.
    const nextSyncCommitteePubkeys = nextSyncCommitteeIndices.map((index) => validators.getReadonly(index).pubkey);

    // Rotate syncCommittee in state
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU({
      pubkeys: nextSyncCommitteePubkeys,
      aggregatePubkey: aggregateSerializedPublicKeys(nextSyncCommitteePubkeys).toBytes(),
    });

    // Rotate syncCommittee cache
    state.epochCtx.rotateSyncCommitteeIndexed(nextSyncCommitteeIndices);
  }
}
