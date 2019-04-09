import assert from "assert";
import xor from "buffer-xor";

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";

import {
  Domain,
  LATEST_RANDAO_MIXES_LENGTH,
} from "../../../constants";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  getRandaoMix,
  hash,
  intToBytes,
} from "../../helpers/stateTransitionHelpers";

import {blsVerify} from "../../../stubs/bls";

export default function processRandao(state: BeaconState, block: BeaconBlock): void {
  const currentEpoch = getCurrentEpoch(state);

  const proposer = state.validatorRegistry[getBeaconProposerIndex(state, state.slot)];
  const randaoRevealVerified = blsVerify(
    proposer.pubkey,
    intToBytes(currentEpoch, 32),
    block.randaoReveal,
    getDomain(state.fork, currentEpoch, Domain.PROPOSAL),
  );
  assert(randaoRevealVerified);
  state.latestRandaoMixes[currentEpoch % LATEST_RANDAO_MIXES_LENGTH] =
    xor(getRandaoMix(state, currentEpoch), hash(block.randaoReveal));
}
