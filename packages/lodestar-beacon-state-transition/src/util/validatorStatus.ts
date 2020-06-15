/**
 * @module chain/stateTransition/util
 */

import {
  BeaconState, Validator, ValidatorIndex, AttesterSlashing, ProposerSlashing, SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import bls from "@chainsafe/bls";
import {bigIntMax} from "@chainsafe/lodestar-utils";

import {FAR_FUTURE_EPOCH, DomainType} from "../constants";
import {computeActivationExitEpoch, getCurrentEpoch, computeEpochAtSlot} from "./epoch";
import {getValidatorChurnLimit, isSlashableValidator, isActiveValidator} from "./validator";
import {decreaseBalance, increaseBalance} from "./balance";
import {getBeaconProposerIndex} from "./proposer";
import {isSlashableAttestationData, isValidIndexedAttestation, getDomain} from ".";
import {computeSigningRoot} from "./signingRoot";


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
  let exitQueueEpoch = computeActivationExitEpoch(config, getCurrentEpoch(config, state));
  state.validators.forEach((v) => {
    if (v.exitEpoch !== FAR_FUTURE_EPOCH) {
      exitQueueEpoch = bigIntMax(v.exitEpoch, exitQueueEpoch);
    }
  });
  const exitQueueChurn = Array.from(state.validators)
    .filter((v: Validator) => v.exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getValidatorChurnLimit(config, state)) {
    exitQueueEpoch += 1n;
  }

  // Set validator exit epoch and withdrawable epoch
  validator.exitEpoch = exitQueueEpoch;
  validator.withdrawableEpoch = validator.exitEpoch + config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
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
  state.validators[slashedIndex].withdrawableEpoch = bigIntMax(
    state.validators[slashedIndex].withdrawableEpoch,
    currentEpoch + config.params.EPOCHS_PER_SLASHINGS_VECTOR
  );

  const slashedBalance = state.validators[slashedIndex].effectiveBalance;
  state.slashings[Number(currentEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR)] += slashedBalance;
  decreaseBalance(
    state,
    slashedIndex,
    state.validators[slashedIndex].effectiveBalance / BigInt(config.params.MIN_SLASHING_PENALTY_QUOTIENT));


  const proposerIndex = getBeaconProposerIndex(config, state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance / BigInt(config.params.WHISTLEBLOWER_REWARD_QUOTIENT);
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
  const header1 = proposerSlashing.signedHeader1.message;
  const header2 = proposerSlashing.signedHeader2.message;
  // Verify the header slots match
  if (header1.slot !== header2.slot) {
    return false;
  }
  // Verify header proposer indices match
  if (header1.proposerIndex !== header2.proposerIndex) {
    return false;
  }
  // Verify the headers are different
  if (config.types.BeaconBlockHeader.equals(header1, header2)) {
    return false;
  }
  const proposer = state.validators[header1.proposerIndex];
  // Check proposer is slashable
  if (!isSlashableValidator(proposer, getCurrentEpoch(config, state))) {
    return false;
  }
  // Verify signatures
  if (!verifySignatures) {
    return true;
  }
  const domain = getDomain(config, state, DomainType.BEACON_PROPOSER, computeEpochAtSlot(config, header1.slot));
  const signingRoot = computeSigningRoot(config, config.types.BeaconBlockHeader,
    proposerSlashing.signedHeader1.message, domain);
  const proposalData1Verified = bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    proposerSlashing.signedHeader1.signature.valueOf() as Uint8Array,
  );
  if (!proposalData1Verified) {
    return false;
  }
  const domain2 = getDomain(config, state, DomainType.BEACON_PROPOSER, computeEpochAtSlot(config, header2.slot));
  const signingRoot2 = computeSigningRoot(config, config.types.BeaconBlockHeader,
    proposerSlashing.signedHeader2.message, domain2);
  const proposalData2Verified = bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot2,
    proposerSlashing.signedHeader2.signature.valueOf() as Uint8Array,
  );
  return proposalData2Verified;
}

export function isValidVoluntaryExit(
  config: IBeaconConfig,
  state: BeaconState,
  signedExit: SignedVoluntaryExit,
  verifySignature = true
): boolean {
  const validator = state.validators[signedExit.message.validatorIndex];
  const currentEpoch = getCurrentEpoch(config, state);
  const domain = getDomain(config, state, DomainType.VOLUNTARY_EXIT, signedExit.message.epoch);
  const signingRoot = computeSigningRoot(config, config.types.VoluntaryExit, signedExit.message, domain);
  // Verify the validator is active
  return (isActiveValidator(validator, currentEpoch)) &&
  // Verify the validator has not yet exited
  (validator.exitEpoch === FAR_FUTURE_EPOCH) &&
  // Exits must specify an epoch when they become valid; they are not valid before then
  (currentEpoch >= signedExit.message.epoch) &&
  // Verify the validator has been active long enough
  (currentEpoch >= validator.activationEpoch + config.params.PERSISTENT_COMMITTEE_PERIOD) &&
  // Verify signature
  (!verifySignature || bls.verify(
    validator.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedExit.signature.valueOf() as Uint8Array,
  ));
}
