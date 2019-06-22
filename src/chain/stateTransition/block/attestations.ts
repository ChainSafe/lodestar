/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";
import chai from "chai";

import {
  BeaconState,
  Crosslink,
  PendingAttestation,
  Attestation,
} from "../../../types";

import {
  MAX_EPOCHS_PER_CROSSLINK,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  ZERO_HASH,
} from "../../../constants";

import {
  getCurrentEpoch,
  getPreviousEpoch,
  convertToIndexed,
  getBeaconProposerIndex,
  getAttestationDataSlot, validateIndexedAttestation,
} from "../util";

// SPEC 0.7
// def process_attestation(state: BeaconState, attestation: Attestation) -> None:
//   """
// Process ``Attestation`` operation.
// """
// data = attestation.data
// attestation_slot = get_attestation_data_slot(state, data)
// assert attestation_slot + MIN_ATTESTATION_INCLUSION_DELAY <= state.slot <= attestation_slot + SLOTS_PER_EPOCH
//
// pending_attestation = PendingAttestation(
//   data=data,
//   aggregation_bitfield=attestation.aggregation_bitfield,
//   inclusion_delay=state.slot - attestation_slot,
//   proposer_index=get_beacon_proposer_index(state),
// )
//
// assert data.target_epoch in (get_previous_epoch(state), get_current_epoch(state))
// if data.target_epoch == get_current_epoch(state):
// ffg_data = (state.current_justified_epoch, state.current_justified_root, get_current_epoch(state))
// parent_crosslink = state.current_crosslinks[data.crosslink.shard]
// state.current_epoch_attestations.append(pending_attestation)
// else:
// ffg_data = (state.previous_justified_epoch, state.previous_justified_root, get_previous_epoch(state))
// parent_crosslink = state.previous_crosslinks[data.crosslink.shard]
// state.previous_epoch_attestations.append(pending_attestation)
//
// # Check FFG data, crosslink data, and signature
// assert ffg_data == (data.source_epoch, data.source_root, data.target_epoch)
// assert data.crosslink.start_epoch == parent_crosslink.end_epoch
// assert data.crosslink.end_epoch == min(data.target_epoch, parent_crosslink.end_epoch + MAX_EPOCHS_PER_CROSSLINK)
// assert data.crosslink.parent_root == hash_tree_root(parent_crosslink)
// assert data.crosslink.data_root == ZERO_HASH  # [to be removed in phase 1]
// validate_indexed_attestation(state, convert_to_indexed(state, attestation))


export default function processAttestation(state: BeaconState, attestation: Attestation): void {
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  const data = attestation.data;
  const attestationSlot = getAttestationDataSlot(state, data);
  let ffgData, parentCrosslink;
  assert(
    attestationSlot + MIN_ATTESTATION_INCLUSION_DELAY <= state.slot &&
    state.slot <= attestationSlot + SLOTS_PER_EPOCH
  );

  // assert([previousEpoch, currentEpoch].includes(data.targetEpoch));

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data: data,
    aggregationBitfield: attestation.aggregationBitfield,
    inclusionDelay: state.slot - attestationSlot,
    proposerIndex: getBeaconProposerIndex(state),
  };

  if (data.targetEpoch === currentEpoch) {
    ffgData = [state.currentJustifiedEpoch, state.currentJustifiedRoot, currentEpoch];
    parentCrosslink = state.currentCrosslinks[data.crosslink.shard];

    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    ffgData = [state.previousJustifiedEpoch, state.previousJustifiedRoot, previousEpoch];
    parentCrosslink = state.previousCrosslinks[data.crosslink.shard];
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check FFG data, crosslink data, and signature
  chai.assert.deepEqual(ffgData,[data.sourceEpoch, data.sourceRoot, data.targetEpoch]);
  assert(data.crosslink.startEpoch == parentCrosslink.endEpoch);
  assert(data.crosslink.endEpoch ==
    Math.min(data.targetEpoch, parentCrosslink.endEpoch + MAX_EPOCHS_PER_CROSSLINK));
  assert(data.crosslink.parentRoot == hashTreeRoot(parentCrosslink, Crosslink));
  assert(data.crosslink.dataRoot == ZERO_HASH);   // [to be removed in phase 1]
  validateIndexedAttestation(state, convertToIndexed(state, attestation));
}
