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
} from "@chainsafe/eth2.0-types";
import {ZERO_HASH} from "@chainsafe/eth2.0-constants";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getCurrentEpoch,
  getIndexedAttestation,
  getBeaconProposerIndex,
  getAttestationDataSlot,
  isValidIndexedAttestation,
  getPreviousEpoch,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#attestations

export function processAttestation(
  config: IBeaconConfig,
  state: BeaconState,
  attestation: Attestation
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  const data = attestation.data;
  assert(data.crosslink.shard < config.params.SHARD_COUNT);
  assert(data.target.epoch === previousEpoch || data.target.epoch === currentEpoch);

  const attestationSlot = getAttestationDataSlot(config, state, data);
  assert(
    attestationSlot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= state.slot &&
    state.slot <= attestationSlot + config.params.SLOTS_PER_EPOCH
  );

  // Cache pending attestation
  const pendingAttestation: PendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: state.slot - attestationSlot,
    proposerIndex: getBeaconProposerIndex(config, state),
  };

  let parentCrosslink: Crosslink;
  if (data.target.epoch === currentEpoch) {
    assert(equals(data.source, state.currentJustifiedCheckpoint, config.types.Checkpoint));
    parentCrosslink = state.currentCrosslinks[data.crosslink.shard];
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    assert(equals(data.source, state.previousJustifiedCheckpoint, config.types.Checkpoint));
    parentCrosslink = state.previousCrosslinks[data.crosslink.shard];
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // Check crosslink against expected parent crosslink
  assert(data.crosslink.parentRoot.equals(hashTreeRoot(parentCrosslink, config.types.Crosslink)));
  assert(data.crosslink.startEpoch == parentCrosslink.endEpoch);
  assert(data.crosslink.endEpoch == Math.min(
    data.target.epoch,
    parentCrosslink.endEpoch + config.params.MAX_EPOCHS_PER_CROSSLINK
  ));
  assert(data.crosslink.dataRoot.equals(ZERO_HASH)); // [to be removed in phase 1]
  // Check signature
  assert(isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation)));
}
