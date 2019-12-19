/**
 * @module chain/stateTransition/util
 */

import {BeaconState, Epoch, Validator, ValidatorIndex, AttesterSlashing, ProposerSlashing,
  VoluntaryExit,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {FAR_FUTURE_EPOCH, DomainType} from "../constants";
import {computeActivationExitEpoch, getCurrentEpoch, computeEpochAtSlot} from "./epoch";
import {getValidatorChurnLimit, isSlashableValidator, isActiveValidator} from "./validator";
import {decreaseBalance, increaseBalance} from "./balance";
import {getBeaconProposerIndex} from "./proposer";
import {isSlashableAttestationData, isValidIndexedAttestation, getDomain} from ".";
import {equals, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";


/**
 * Initiate exit for the validator with the given index.
 *
 * Note: that this function mutates state.
 */
export function initiateValidatorExit(config: IBeaconConfig, state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validators[index];

  // Return if validator already initiated exit
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // Compute exit queue epoch
  let exitQueueEpoch = state.validators.reduce((epoch: Epoch, v: Validator) => {
    if (v.exitEpoch !== FAR_FUTURE_EPOCH) {
      return Math.max(v.exitEpoch, epoch);
    }
    return epoch;
  }, computeActivationExitEpoch(config, getCurrentEpoch(config, state)));
  const exitQueueChurn = state.validators
    .filter((v: Validator) => v.exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getValidatorChurnLimit(config, state)) {
    exitQueueEpoch += 1;
  }

  // Set validator exit epoch and withdrawable epoch
  validator.exitEpoch = exitQueueEpoch;
  validator.withdrawableEpoch = validator.exitEpoch + config.params.MIN_VALIDATOR_WITHDRAWAL_DELAY;
}

/**
 * Slash the validator with index ``slashedIndex``.
 *
 * Note that this function mutates ``state``.
 */
export function slashValidator(
  config: IBeaconConfig,
  state: BeaconState,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex: ValidatorIndex | null = null
): void {
  const currentEpoch = getCurrentEpoch(config, state);

  initiateValidatorExit(config, state, slashedIndex);
  state.validators[slashedIndex].slashed = true;
  state.validators[slashedIndex].withdrawableEpoch = Math.max(
    state.validators[slashedIndex].withdrawableEpoch,
    currentEpoch + config.params.EPOCHS_PER_SLASHINGS_VECTOR
  );

  const slashedBalance = state.validators[slashedIndex].effectiveBalance;
  state.slashings[currentEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR] += slashedBalance;
  decreaseBalance(
    state,
    slashedIndex,
    state.validators[slashedIndex].effectiveBalance / BigInt(config.params.MIN_SLASHING_PENALTY_QUOTIENT));


  const proposerIndex = getBeaconProposerIndex(config, state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance / BigInt(config.params.WHISTLEBLOWING_REWARD_QUOTIENT);
  const proposerReward = whistleblowingReward/ BigInt(config.params.PROPOSER_REWARD_QUOTIENT);
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowingReward - proposerReward);
}

export function isValidAttesterSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  attesterSlashing: AttesterSlashing,
  verifySignatures = true
): boolean {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  return isSlashableAttestationData(config, attestation1.data, attestation2.data) &&
    isValidIndexedAttestation(config, state, attestation1, verifySignatures) &&
    isValidIndexedAttestation(config, state, attestation2, verifySignatures);
}

export function isValidProposerSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true
): boolean {
  const proposer = state.validators[proposerSlashing.proposerIndex];
  const header1Epoch = computeEpochAtSlot(config, proposerSlashing.header1.slot);
  const header2Epoch = computeEpochAtSlot(config, proposerSlashing.header2.slot);
  // Verify slots match
  if (proposerSlashing.header1.slot !== proposerSlashing.header2.slot) {
    return false;
  }
  // But the headers are different
  if (equals(config.types.BeaconBlockHeader, proposerSlashing.header1, proposerSlashing.header2)) {
    return false;
  }
  // Check proposer is slashable
  if (!isSlashableValidator(proposer, getCurrentEpoch(config, state))) {
    return false;
  }
  // Signatures are valid
  if (!verifySignatures) {
    return true;
  }
  const proposalData1Verified = bls.verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlockHeader, proposerSlashing.header1),
    proposerSlashing.header1.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER, header1Epoch),
  );
  if (!proposalData1Verified) {
    return false;
  }
  const proposalData2Verified = bls.verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlockHeader, proposerSlashing.header2),
    proposerSlashing.header2.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER, header2Epoch),
  );
  return proposalData2Verified;
}

export function isValidVoluntaryExit(
  config: IBeaconConfig,
  state: BeaconState,
  exit: VoluntaryExit,
  verifySignature = true
): boolean {
  const validator = state.validators[exit.validatorIndex];
  const currentEpoch = getCurrentEpoch(config, state);
  // Verify the validator is active
  return (isActiveValidator(validator, currentEpoch)) &&
  // Verify the validator has not yet exited
  (validator.exitEpoch === FAR_FUTURE_EPOCH) &&
  // Exits must specify an epoch when they become valid; they are not valid before then
  (currentEpoch >= exit.epoch) &&
  // Verify the validator has been active long enough
  (currentEpoch >= validator.activationEpoch + config.params.PERSISTENT_COMMITTEE_PERIOD) &&
  // Verify signature
  (!verifySignature || bls.verify(
    validator.pubkey,
    signingRoot(config.types.VoluntaryExit, exit),
    exit.signature,
    getDomain(config, state, DomainType.VOLUNTARY_EXIT, exit.epoch),
  ));
}
