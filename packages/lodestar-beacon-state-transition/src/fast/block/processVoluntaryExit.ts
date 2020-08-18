import {Signature} from "@chainsafe/bls";
import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";

import {DomainType, FAR_FUTURE_EPOCH} from "../../constants";
import {computeSigningRoot, getDomain, isActiveValidator} from "../../util";
import {EpochContext} from "../util";
import {initiateValidatorExit} from "./initiateValidatorExit";


export function processVoluntaryExit(
  epochCtx: EpochContext,
  state: BeaconState,
  signedVoluntaryExit: SignedVoluntaryExit,
  verifySignature = true,
): void {
  const config = epochCtx.config;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators[voluntaryExit.validatorIndex];
  const currentEpoch = epochCtx.currentShuffling.epoch;
  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new Error("VoluntaryExit validator is not active");
  }
  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new Error(
      "VoluntaryExit validator exit has already been initiated: " +
            `exitEpoch=${validator.exitEpoch}`
    );
  }
  // exits must specify an epoch when they become valid; they are not valid before then
  if (!(currentEpoch >= voluntaryExit.epoch)) {
    throw new Error(
      "VoluntaryExit epoch is not yet valid: " +
            `epoch=${voluntaryExit.epoch} currentEpoch=${currentEpoch}`
    );
  }
  // verify the validator had been active long enough
  if (!(currentEpoch >= validator.activationEpoch + config.params.SHARD_COMMITTEE_PERIOD)) {
    throw new Error("VoluntaryExit validator has not been active for long enough");
  }
  // verify signature
  if (verifySignature) {
    const domain = getDomain(config, state, DomainType.VOLUNTARY_EXIT, voluntaryExit.epoch);
    const signingRoot = computeSigningRoot(config, config.types.VoluntaryExit, voluntaryExit, domain);
    const pubkey = epochCtx.index2pubkey[voluntaryExit.validatorIndex];
    if (!pubkey.verifyMessage(
      Signature.fromCompressedBytes(signedVoluntaryExit.signature.valueOf() as Uint8Array),
      signingRoot,
    )) {
      throw new Error("VoluntaryExit has an invalid signature");
    }
  }
  // initiate exit
  initiateValidatorExit(epochCtx, state, voluntaryExit.validatorIndex);
}

