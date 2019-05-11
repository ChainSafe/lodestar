/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  Epoch,
} from "../../../types";

import {
  Domain,
  LATEST_RANDAO_MIXES_LENGTH,
} from "../../../constants";

import bls from "@chainsafe/bls-js";

import {hash} from "../../../util/crypto";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  getRandaoMix,
} from "../util";


export default function processRandao(state: BeaconState, block: BeaconBlock): void {
  const currentEpoch = getCurrentEpoch(state);
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state)];

  // Verify that the provided randao value is valid
  const randaoRevealVerified = bls.verify(
    proposer.pubkey,
    hashTreeRoot(getCurrentEpoch(state), Epoch),
    block.body.randaoReveal,
    getDomain(state, Domain.RANDAO),
  );
  assert(randaoRevealVerified);

  // Mix it in
  state.latestRandaoMixes[currentEpoch % LATEST_RANDAO_MIXES_LENGTH] =
    xor(getRandaoMix(state, currentEpoch), hash(block.body.randaoReveal));
}
