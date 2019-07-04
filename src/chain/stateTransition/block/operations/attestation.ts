/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {equals, hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconState,
  Crosslink,
  PendingAttestation,
  Attestation,
  FFGData,
} from "../../../../types";
import {ZERO_HASH} from "../../../../constants";
import {BeaconConfig} from "../../../../config";

import {
  getCurrentEpoch,
  getPreviousEpoch,
  convertToIndexed,
  getBeaconProposerIndex,
  getAttestationDataSlot,
  validateIndexedAttestation,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#attestations

export function processAttestation(
  config: BeaconConfig,
  state: BeaconState,
  attestation: Attestation
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  const data = attestation.data;
  const attestationSlot = getAttestationDataSlot(config, state, data);
  let ffgData: FFGData, parentCrosslink: Crosslink;
  assert(
    attestationSlot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= state.slot &&
    state.slot <= attestationSlot + config.params.SLOTS_PER_EPOCH
  );

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data: data,
    aggregationBitfield: attestation.aggregationBitfield,
    inclusionDelay: state.slot - attestationSlot,
    proposerIndex: getBeaconProposerIndex(config, state),
  };

  if (data.targetEpoch === currentEpoch) {
    ffgData = {
      sourceEpoch: state.currentJustifiedEpoch,
      sourceRoot: state.currentJustifiedRoot,
      targetEpoch: currentEpoch,
    };
    parentCrosslink = state.currentCrosslinks[data.crosslink.shard];

    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    ffgData = {
      sourceEpoch: state.previousJustifiedEpoch,
      sourceRoot: state.previousJustifiedRoot,
      targetEpoch: previousEpoch,
    };
    parentCrosslink = state.previousCrosslinks[data.crosslink.shard];
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check FFG data, crosslink data, and signature
  assert(
    equals(ffgData, {
      sourceEpoch: data.sourceEpoch,
      sourceRoot: data.sourceRoot,
      targetEpoch: data.targetEpoch
    }, config.types.FFGData));
  assert(data.crosslink.startEpoch == parentCrosslink.endEpoch);
  assert(data.crosslink.endEpoch ==
    Math.min(data.targetEpoch, parentCrosslink.endEpoch + config.params.MAX_EPOCHS_PER_CROSSLINK));
  assert(data.crosslink.parentRoot.equals(hashTreeRoot(parentCrosslink, config.types.Crosslink)));
  assert(data.crosslink.dataRoot.equals(ZERO_HASH));   // [to be removed in phase 1]
  validateIndexedAttestation(config, state, convertToIndexed(config, state, attestation));
}
