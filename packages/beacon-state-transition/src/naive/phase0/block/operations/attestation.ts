/**
 * @module chain/stateTransition/block
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";

import {
  computeEpochAtSlot,
  getBeaconProposerIndex,
  getBeaconCommittee,
  getCurrentEpoch,
  getIndexedAttestation,
  getPreviousEpoch,
  isValidIndexedAttestation,
  getCommitteeCountAtSlot,
} from "../../../../util";

export function processAttestation(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  const data = attestation.data;
  assert.lt(data.index, getCommitteeCountAtSlot(state, data.slot), "Attestation index out of bounds");
  assert.true(
    data.target.epoch === previousEpoch || data.target.epoch === currentEpoch,
    `Attestation is targeting too old epoch ${data.target.epoch}, current=${currentEpoch}`
  );
  assert.equal(data.target.epoch, computeEpochAtSlot(data.slot), "Attestation is not targeting current epoch");

  const committee = getBeaconCommittee(state, data.slot, data.index);
  assert.equal(attestation.aggregationBits.length, committee.length, "Attestation invalid aggregationBits length");

  // Cache pending attestation
  const pendingAttestation: phase0.PendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: state.slot - data.slot,
    proposerIndex: getBeaconProposerIndex(state),
  };

  if (data.target.epoch === currentEpoch) {
    assert.true(
      ssz.phase0.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint),
      "Attestation invalid source"
    );
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    assert.true(
      ssz.phase0.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint),
      "Attestation invalid source"
    );
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check signature
  assert.true(
    isValidIndexedAttestation(state, getIndexedAttestation(state, attestation), verifySignature),
    "Attestation invalid signature"
  );
}
