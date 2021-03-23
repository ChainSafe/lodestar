/**
 * @module chain/stateTransition/block
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient, phase0, ValidatorFlag} from "@chainsafe/lodestar-types";
import {assert, intSqrt} from "@chainsafe/lodestar-utils";
import {TIMELY_HEAD_FLAG, TIMELY_SOURCE_FLAG, TIMELY_TARGET_FLAG, FLAG_DENOMINATOR} from "../../constants";
import {addValidatorFlags, getFlagsAndNumerators, hasValidatorFlags} from "../../misc";
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
import {getBaseReward} from "../epoch/balance_utils";
import {increaseBalance} from "../../../util/balance";

export function processAttestation(
  config: IBeaconConfig,
  state: lightclient.BeaconState,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  const data = attestation.data;
  assert.lt(data.index, getCommitteeCountAtSlot(config, state, data.slot), "Attestation index out of bounds");
  assert.true(
    data.target.epoch === previousEpoch || data.target.epoch === currentEpoch,
    `Attestation is targeting too old epoch ${data.target.epoch}, current=${currentEpoch}`
  );
  assert.equal(data.target.epoch, computeEpochAtSlot(config, data.slot), "Attestation is not targeting current epoch");

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

  const isMatchingSource = config.types.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  assert.true(isMatchingSource, "Attestation invalid source");
  const isMatchingHead = config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot));
  const isMatchingTarget = config.types.Root.equals(data.target.root, getBlockRoot(config, state, data.target.epoch));

  // Check signature
  assert.true(
    isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation), verifySignature),
    "Attestation invalid signature"
  );

  const participationFlagIndices: ValidatorFlag[] = [];

  if (isMatchingHead && isMatchingTarget && state.slot <= data.slot + config.params.MIN_ATTESTATION_INCLUSION_DELAY) {
    participationFlagIndices.push(TIMELY_HEAD_FLAG);
  }
  if (isMatchingSource && state.slot <= data.slot + intSqrt(config.params.SLOTS_PER_EPOCH)) {
    participationFlagIndices.push(TIMELY_SOURCE_FLAG);
  }
  if (isMatchingTarget && state.slot <= data.slot + config.params.SLOTS_PER_EPOCH) {
    participationFlagIndices.push(TIMELY_TARGET_FLAG);
  }

  let proposerRewardNumerator = BigInt(0);
  for (const index of getAttestingIndices(config, state, data, attestation.aggregationBits)) {
    for (const [flag, numerator] of getFlagsAndNumerators()) {
      if (participationFlagIndices.indexOf(flag) !== -1 && !hasValidatorFlags(epochParticipation[index], flag)) {
        epochParticipation[index] = addValidatorFlags(epochParticipation[index], flag);
        proposerRewardNumerator += getBaseReward(config, state, index) * BigInt(numerator);
      }
    }
  }
  const proposerReward = proposerRewardNumerator / (FLAG_DENOMINATOR * BigInt(config.params.PROPOSER_REWARD_QUOTIENT));
  increaseBalance(state, getBeaconProposerIndex(config, state), proposerReward);
}
