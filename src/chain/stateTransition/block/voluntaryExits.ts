import assert from "assert";

import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  VoluntaryExit,
} from "../../../types";

import {
  Domain,
  EMPTY_SIGNATURE,
  MAX_VOLUNTARY_EXITS,
} from "../../../constants";

import {
  getCurrentEpoch,
  getDomain,
  getEntryExitEffectEpoch,
} from "../../helpers/stateTransitionHelpers";

import {
  initiateValidatorExit,
} from "../../helpers/validatorStatus";

import { blsVerify } from "../../../stubs/bls";

export default function processVoluntaryExits(state: BeaconState, block: BeaconBlock): void {
  const currentEpoch = getCurrentEpoch(state);
  assert(block.body.voluntaryExits.length <= MAX_VOLUNTARY_EXITS);
  for (const exit of block.body.voluntaryExits) {
    const validator = state.validatorRegistry[exit.validatorIndex];
    assert(validator.exitEpoch > getEntryExitEffectEpoch(currentEpoch));
    assert(currentEpoch >= exit.epoch);
    const v: VoluntaryExit = {
      epoch: exit.epoch,
      validatorIndex: exit.validatorIndex,
      signature: EMPTY_SIGNATURE,
    };
    const exitMessage = hashTreeRoot(v, VoluntaryExit);
    const exitMessageVerified = blsVerify(
      validator.pubkey,
      exitMessage,
      exit.signature,
      getDomain(state.fork, exit.epoch, Domain.EXIT),
    );
    assert(exitMessageVerified);
    initiateValidatorExit(state, exit.validatorIndex);
  }
}
