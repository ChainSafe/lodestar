import {verify} from "@chainsafe/bls";
import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";

import {DomainType, FAR_FUTURE_EPOCH} from "../../constants";
import {computeSigningRoot, getDomain, isActiveValidator} from "../../util";
import {EpochContext} from "../util";
import {initiateValidatorExit} from "./initiateValidatorExit";


export function processVoluntaryExit(
  epochCtx: EpochContext,
  state: BeaconState,
  signedVoluntaryExit: SignedVoluntaryExit,
): void {
  const config = epochCtx.config;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators[voluntaryExit.validatorIndex];
  const currentEpoch = epochCtx.currentShuffling.epoch;
  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new Error();
  }
  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new Error();
  }
  // exits must specify an epoch when they become valid; they are not valid before then
  if (!(currentEpoch >= voluntaryExit.epoch)) {
    throw new Error();
  }
  // verify the validator had been active long enough
  if (!(currentEpoch >= validator.activationEpoch + config.params.PERSISTENT_COMMITTEE_PERIOD)) {
    throw new Error();
  }
  // verify signature
  const domain = getDomain(config, state, DomainType.VOLUNTARY_EXIT, voluntaryExit.epoch);
  const signingRoot = computeSigningRoot(config, config.types.VoluntaryExit, voluntaryExit, domain);
  if (!verify(
    validator.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedVoluntaryExit.signature.valueOf() as Uint8Array,
  )) {
    throw new Error();
  }
  // initiate exit
  initiateValidatorExit(epochCtx, state, voluntaryExit.validatorIndex);
}

