import assert from "assert";

import {treeHash} from "@chainsafesystems/ssz";

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
} from "../../../helpers/stateTransitionHelpers";

import { initiateValidatorExit } from "../../state";

import { blsVerify } from "../../stubs/bls";

export default function processVoluntaryExits(state: BeaconState, block: BeaconBlock) {
  const currentEpoch = getCurrentEpoch(state);
  assert(block.body.voluntaryExits.length <= MAX_VOLUNTARY_EXITS);
  for (const exit of block.body.voluntaryExits) {
    const validator = state.validatorRegistry[exit.validatorIndex.toNumber()];
    assert(validator.exitEpoch.gt(getEntryExitEffectEpoch(currentEpoch)));
    assert(currentEpoch.gte(exit.epoch));
    const exitMessage = treeHash({
      epoch: exit.epoch,
      validatorIndex: exit.validatorIndex,
      signature: EMPTY_SIGNATURE,
    } as VoluntaryExit);
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
