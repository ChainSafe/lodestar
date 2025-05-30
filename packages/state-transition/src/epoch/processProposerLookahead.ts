import {aggregateSerializedPublicKeys} from "@chainsafe/blst";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateAltair} from "../types.js";
import {getNextSyncCommitteeIndices} from "../util/seed.js";

/**
 * Rotate nextSyncCommittee to currentSyncCommittee if sync committee period is over.
 *
 * PERF: Once every `EPOCHS_PER_SYNC_COMMITTEE_PERIOD`, do an expensive operation to compute the next committee.
 * Calculating the next sync committee has a proportional cost to $VALIDATOR_COUNT
 */
// TODO Fulu: Implement this
export function processProposerLookahead(fork: ForkSeq, state: CachedBeaconStateAltair): void {
}
