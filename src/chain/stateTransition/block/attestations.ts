/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  Crosslink,
  PendingAttestation,
  Attestation,
} from "../../../types";

import {
  MAX_ATTESTATIONS,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  ZERO_HASH,
  GENESIS_SLOT,
  GENESIS_EPOCH,
} from "../../../constants";

import {
  getCurrentEpoch,
  slotToEpoch,
  getPreviousEpoch,
  verifyIndexedAttestation,
  convertToIndexed,
  getBeaconProposerIndex,
} from "../../stateTransition/util";


export function processAttestation(state: BeaconState, attestation: Attestation): void {
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  const data = attestation.data;
  const minSlot =  currentEpoch > GENESIS_EPOCH
    ? state.slot - SLOTS_PER_EPOCH
    : GENESIS_SLOT;
  assert(minSlot <= data.slot && data.slot <= state.slot - MIN_ATTESTATION_INCLUSION_DELAY);

  // Check target epoch, source epoch, and source root
  const targetEpoch = slotToEpoch(data.slot);
  assert((
    currentEpoch === targetEpoch &&
    state.currentJustifiedEpoch === data.sourceEpoch &&
    state.currentJustifiedRoot.equals(data.sourceRoot) &&
    hashTreeRoot(state.currentCrosslinks[data.shard], Crosslink).equals(data.previousCrosslinkRoot)
  ) || (
    previousEpoch === targetEpoch &&
    state.previousJustifiedEpoch === data.sourceEpoch &&
    state.previousJustifiedRoot.equals(data.sourceRoot) &&
    hashTreeRoot(state.previousCrosslinks[data.shard], Crosslink).equals(data.previousCrosslinkRoot)
  ));

  // Check crosslink data
  assert(data.crosslinkDataRoot.equals(ZERO_HASH)); // TO BE REMOVED IN PHASE 1

  // Check signature and bitfields
  assert(verifyIndexedAttestation(state, convertToIndexed(state, attestation)));

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data,
    aggregationBitfield: attestation.aggregationBitfield,
    inclusionSlot: state.slot,
    proposerIndex: getBeaconProposerIndex(state),
  };

  if (targetEpoch === currentEpoch) {
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    state.previousEpochAttestations.push(pendingAttestation);
  }
}

export default function processAttestations(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.attestations.length <= MAX_ATTESTATIONS);
  for (const attestation of block.body.attestations) {
    processAttestation(state, attestation);
  }
}
