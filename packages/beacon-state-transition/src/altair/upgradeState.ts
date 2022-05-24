import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0, CachedBeaconStateAltair} from "../types.js";
import {newZeroedArray} from "../util/index.js";
import {getAttestationParticipationStatus, RootCache} from "./block/processAttestation.js";
import {getNextSyncCommittee} from "../util/syncCommittee.js";
import {CompositeViewDU} from "@chainsafe/ssz";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from phase0 to altair.
 */
export function upgradeState(statePhase0: CachedBeaconStatePhase0): CachedBeaconStateAltair {
  const {config} = statePhase0;

  // Get underlying node and cast phase0 tree to altair tree
  //
  // A phase0 BeaconState tree can be safely casted to an altair BeaconState tree because:
  // - Deprecated fields are replaced by new fields at the exact same indexes
  // - All new fields are appended at the end
  //
  // So by just setting all new fields to some value, all the old nodes are dropped
  //
  // phase0                        | op   | altair
  // ----------------------------- | ---- | ------------
  // genesis_time                  | -    | genesis_time
  // genesis_validators_root       | -    | genesis_validators_root
  // slot                          | -    | slot
  // fork                          | -    | fork
  // latest_block_header           | -    | latest_block_header
  // block_roots                   | -    | block_roots
  // state_roots                   | -    | state_roots
  // historical_roots              | -    | historical_roots
  // eth1_data                     | -    | eth1_data
  // eth1_data_votes               | -    | eth1_data_votes
  // eth1_deposit_index            | -    | eth1_deposit_index
  // validators                    | -    | validators
  // balances                      | -    | balances
  // randao_mixes                  | -    | randao_mixes
  // slashings                     | -    | slashings
  // previous_epoch_attestations   | diff | previous_epoch_participation
  // current_epoch_attestations    | diff | current_epoch_participation
  // justification_bits            | -    | justification_bits
  // previous_justified_checkpoint | -    | previous_justified_checkpoint
  // current_justified_checkpoint  | -    | current_justified_checkpoint
  // finalized_checkpoint          | -    | finalized_checkpoint
  // -                             | new  | inactivity_scores
  // -                             | new  | current_sync_committee
  // -                             | new  | next_sync_committee

  const statePhase0Node = ssz.phase0.BeaconState.commitViewDU(statePhase0);
  const stateAltairView = ssz.altair.BeaconState.getViewDU(statePhase0Node);
  // Attach existing BeaconStateCache from statePhase0 to new stateAltairView object
  const stateAltair = getCachedBeaconState(stateAltairView, statePhase0);

  stateAltair.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: statePhase0.fork.currentVersion,
    currentVersion: config.ALTAIR_FORK_VERSION,
    epoch: statePhase0.epochCtx.epoch,
  });

  const validatorCount = statePhase0.validators.length;
  const emptyEpochParticipationView = ssz.altair.EpochParticipation.toViewDU(newZeroedArray(validatorCount));
  const emptyEpochParticipationNode = ssz.altair.EpochParticipation.commitViewDU(emptyEpochParticipationView);
  stateAltair.previousEpochParticipation = emptyEpochParticipationView;
  // Cloned instance with same immutable Node
  stateAltair.currentEpochParticipation = ssz.altair.EpochParticipation.getViewDU(emptyEpochParticipationNode);

  stateAltair.inactivityScores = ssz.altair.InactivityScores.toViewDU(newZeroedArray(validatorCount));

  const {syncCommittee, indices} = getNextSyncCommittee(
    stateAltair,
    stateAltair.epochCtx.nextShuffling.activeIndices,
    stateAltair.epochCtx.effectiveBalanceIncrements
  );
  const syncCommitteeView = ssz.altair.SyncCommittee.toViewDU(syncCommittee);

  stateAltair.currentSyncCommittee = syncCommitteeView;
  stateAltair.nextSyncCommittee = syncCommitteeView;
  stateAltair.epochCtx.setSyncCommitteesIndexed(indices);

  const pendingAttesations = statePhase0.previousEpochAttestations;
  translateParticipation(stateAltair, pendingAttesations);

  // Commit new added fields ViewDU to the root node
  stateAltair.commit();
  // Clear cache to ensure the cache of phase0 fields is not used by new altair fields
  // [15] previous_epoch_attestations -> previous_epoch_participation
  // [16] current_epoch_attestations -> current_epoch_participation
  //
  // TODO: This could only drop the caches of index 15,16. However this would couple this code tightly with SSZ ViewDU
  //       internals. If the cache is not cleared, consuming the ViewDU instance could break in strange ways.
  stateAltair["clearCache"]();

  return stateAltair;
}

/**
 * Translate_participation in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/fork.md
 */
function translateParticipation(
  state: CachedBeaconStateAltair,
  pendingAttesations: CompositeViewDU<typeof ssz.phase0.EpochAttestations>
): void {
  const {epochCtx} = state;
  const rootCache = new RootCache(state);
  const epochParticipation = state.previousEpochParticipation;

  for (const attestation of pendingAttesations.getAllReadonly()) {
    const data = attestation.data;
    const attestationFlags = getAttestationParticipationStatus(
      data,
      attestation.inclusionDelay,
      epochCtx.epoch,
      rootCache
    );

    const committeeIndices = epochCtx.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = attestation.aggregationBits.intersectValues(committeeIndices);

    for (const index of attestingIndices) {
      // ParticipationFlags type uses option {setBitwiseOR: true}, .set() does a |= operation
      epochParticipation.set(index, attestationFlags);
    }
  }
}
