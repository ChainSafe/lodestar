/**
 * @module chain/stateTransition/block
 */

import {Attestation, BeaconState, PendingAttestation,} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
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
  assert(data.target.epoch === computeEpochAtSlot(config, data.slot));

  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  assert(
    attestation.aggregationBits.length === committee.length
  );

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: state.slot - data.slot,
    proposerIndex: getBeaconProposerIndex(config, state),
  };

  if (data.target.epoch === currentEpoch) {
    assert(config.types.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint));
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    assert(config.types.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint));
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check signature
  assert(isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation), verifySignature));
}
