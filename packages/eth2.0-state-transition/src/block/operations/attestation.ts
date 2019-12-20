/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {equals} from "@chainsafe/ssz";

import {Attestation, BeaconState, PendingAttestation,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getBeaconProposerIndex,
  getBeaconCommittee,
  getCurrentEpoch,
  getIndexedAttestation,
  getPreviousEpoch,
  isValidIndexedAttestation,
  getCommitteeCountAtSlot,
} from "../../util";

export function processAttestation(
  config: IBeaconConfig,
  state: BeaconState,
  attestation: Attestation,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  const data = attestation.data;
  assert(data.index < getCommitteeCountAtSlot(config, state, data.slot));
  assert(data.target.epoch === previousEpoch || data.target.epoch === currentEpoch);

  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  assert(
    attestation.aggregationBits.bitLength === committee.length
  );

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: state.slot - data.slot,
    proposerIndex: getBeaconProposerIndex(config, state),
  };

  if (data.target.epoch === currentEpoch) {
    assert(equals(config.types.Checkpoint, data.source, state.currentJustifiedCheckpoint));
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    assert(equals(config.types.Checkpoint, data.source, state.previousJustifiedCheckpoint));
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check signature
  assert(isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation), verifySignature));
}
