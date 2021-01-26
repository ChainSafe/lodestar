import {SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {DomainType, FAR_FUTURE_EPOCH} from "../../constants";
import {computeSigningRoot, getDomain, isActiveValidator} from "../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {initiateValidatorExit} from "./initiateValidatorExit";

export function processVoluntaryExit(
  cachedState: CachedBeaconState,
  signedVoluntaryExit: SignedVoluntaryExit,
  verifySignature = true
): void {
  const config = cachedState.config;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = cachedState.validators[voluntaryExit.validatorIndex];
  const currentEpoch = cachedState.currentShuffling.epoch;
  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new Error("VoluntaryExit validator is not active");
  }
  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new Error("VoluntaryExit validator exit has already been initiated: " + `exitEpoch=${validator.exitEpoch}`);
  }
  // exits must specify an epoch when they become valid; they are not valid before then
  if (!(currentEpoch >= voluntaryExit.epoch)) {
    throw new Error(
      "VoluntaryExit epoch is not yet valid: " + `epoch=${voluntaryExit.epoch} currentEpoch=${currentEpoch}`
    );
  }
  // verify the validator had been active long enough
  if (!(currentEpoch >= validator.activationEpoch + config.params.SHARD_COMMITTEE_PERIOD)) {
    throw new Error("VoluntaryExit validator has not been active for long enough");
  }

  // verify signature
  if (verifySignature) {
    const signatureSet = getVoluntaryExitSignatureSet(cachedState, signedVoluntaryExit);
    if (!verifySignatureSet(signatureSet)) {
      throw new Error("VoluntaryExit has an invalid signature");
    }
  }

  // initiate exit
  initiateValidatorExit(cachedState, voluntaryExit.validatorIndex);
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  cachedState: CachedBeaconState,
  signedVoluntaryExit: SignedVoluntaryExit
): ISignatureSet {
  const config = cachedState.config;
  const domain = getDomain(config, cachedState, DomainType.VOLUNTARY_EXIT, signedVoluntaryExit.message.epoch);

  return {
    type: SignatureSetType.single,
    pubkey: cachedState.index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(config, config.types.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}
