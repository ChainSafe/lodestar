import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";
import {aggregatePublicKeys} from "@chainsafe/bls";
import {CachedBeaconStateAltair} from "../../types";
import {getNextSyncCommitteeIndices} from "../../util/seed";

/**
 * Rotate nextSyncCommittee to currentSyncCommittee if sync committee period is over.
 *
 * PERF: Once every `EPOCHS_PER_SYNC_COMMITTEE_PERIOD`, do an expensive operation to compute the next committee.
 * Calculating the next sync committee has a proportional cost to $VALIDATOR_COUNT
 */
export function processSyncCommitteeUpdates(state: CachedBeaconStateAltair): void {
  const nextEpoch = state.epochCtx.epoch + 1;

  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    const activeValidatorIndices = state.epochCtx.nextShuffling.activeIndices;
    const {effectiveBalanceIncrements} = state.epochCtx;

    const nextSyncCommitteeIndices = getNextSyncCommitteeIndices(
      state,
      activeValidatorIndices,
      effectiveBalanceIncrements
    );

    // Using the index2pubkey cache is slower because it needs the serialized pubkey.
    const nextSyncCommitteePubkeys = nextSyncCommitteeIndices.map(
      (index) => state.validators[index].pubkey.valueOf() as Uint8Array
    );

    // Rotate syncCommittee in state
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = {
      pubkeys: nextSyncCommitteePubkeys,
      aggregatePubkey: aggregatePublicKeys(nextSyncCommitteePubkeys),
    };

    state.epochCtx.rotateSyncCommitteeIndexed(nextSyncCommitteeIndices);
  }
}
