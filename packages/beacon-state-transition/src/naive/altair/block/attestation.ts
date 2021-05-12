/**
 * @module chain/stateTransition/block
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0, ParticipationFlags} from "@chainsafe/lodestar-types";
import {assert, intSqrt} from "@chainsafe/lodestar-utils";
import {
  PROPOSER_WEIGHT,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "../../../altair/constants";
import {addFlag, getFlagIndicesAndWeights, hasFlag} from "../../../altair/misc";
import {
  getCurrentEpoch,
  getPreviousEpoch,
  getCommitteeCountAtSlot,
  computeEpochAtSlot,
  getBeaconCommittee,
  getBlockRoot,
  getBlockRootAtSlot,
  isValidIndexedAttestation,
  getIndexedAttestation,
  getAttestingIndices,
  getBeaconProposerIndex,
} from "../../../util";
import {getBaseReward} from "../../../altair/state_accessor";
import {increaseBalance} from "../../../util/balance";

export function processAttestation(
  config: IBeaconConfig,
  state: altair.BeaconState,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  const data = attestation.data;
  assert.true(
    data.target.epoch === previousEpoch || data.target.epoch === currentEpoch,
    `Attestation is targeting too old epoch ${data.target.epoch}, current=${currentEpoch}`
  );
  assert.equal(data.target.epoch, computeEpochAtSlot(config, data.slot), "Attestation slot does not match target");
  assert.lte(data.slot + config.params.MIN_ATTESTATION_INCLUSION_DELAY, state.slot);
  assert.lte(state.slot, data.slot + config.params.SLOTS_PER_EPOCH);
  assert.lt(data.index, getCommitteeCountAtSlot(config, state, data.slot), "Attestation index out of bounds");

  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  assert.equal(attestation.aggregationBits.length, committee.length, "Attestation invalid aggregationBits length");

  let epochParticipation, justifiedCheckpoint;
  if (data.target.epoch === currentEpoch) {
    epochParticipation = state.currentEpochParticipation;
    justifiedCheckpoint = state.currentJustifiedCheckpoint;
  } else {
    epochParticipation = state.previousEpochParticipation;
    justifiedCheckpoint = state.previousJustifiedCheckpoint;
  }

  const isMatchingHead = config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot));
  const isMatchingSource = config.types.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  const isMatchingTarget = config.types.Root.equals(data.target.root, getBlockRoot(config, state, data.target.epoch));
  assert.true(isMatchingSource, "Attestation invalid source");

  // Check signature
  assert.true(
    isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation), verifySignature),
    "Attestation invalid signature"
  );

  const participationFlagIndices: ParticipationFlags[] = [];

  if (isMatchingHead && isMatchingTarget && state.slot <= data.slot + config.params.MIN_ATTESTATION_INCLUSION_DELAY) {
    participationFlagIndices.push(TIMELY_HEAD_FLAG_INDEX);
  }
  if (isMatchingSource && state.slot <= data.slot + intSqrt(config.params.SLOTS_PER_EPOCH)) {
    participationFlagIndices.push(TIMELY_SOURCE_FLAG_INDEX);
  }
  if (isMatchingTarget && state.slot <= data.slot + config.params.SLOTS_PER_EPOCH) {
    participationFlagIndices.push(TIMELY_TARGET_FLAG_INDEX);
  }

  let proposerRewardNumerator = BigInt(0);
  for (const index of getAttestingIndices(config, state, data, attestation.aggregationBits)) {
    for (const [flag, weight] of getFlagIndicesAndWeights()) {
      if (participationFlagIndices.indexOf(flag) !== -1 && !hasFlag(epochParticipation[index], flag)) {
        epochParticipation[index] = addFlag(epochParticipation[index], flag);
        proposerRewardNumerator += getBaseReward(config, state, index) * weight;
      }
    }
  }
  const proposerRewardDenominator = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;
  const proposerReward = proposerRewardNumerator / proposerRewardDenominator;
  increaseBalance(state, getBeaconProposerIndex(config, state), proposerReward);
}
