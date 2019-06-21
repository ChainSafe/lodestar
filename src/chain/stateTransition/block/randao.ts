/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconBlockBody, BeaconState, Epoch,} from "../../../types";

import {Domain, EMPTY_SIGNATURE, LATEST_RANDAO_MIXES_LENGTH, ZERO_HASH,} from "../../../constants";

import bls from "@chainsafe/bls-js";

import {hash} from "../../../util/crypto";

import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";


export default function processRandao(state: BeaconState, body: BeaconBlockBody): void {
  const currentEpoch = getCurrentEpoch(state);
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state)];
  // Verify that the provided randao value is valid
  const randaoRevealVerified =
    bls.verify(
      proposer.pubkey,
      hashTreeRoot(currentEpoch, Epoch),
      body.randaoReveal,
      getDomain(state, Domain.RANDAO),
    )
    ||
    //empty block, it seems that empty stuff should be verified positively here
    (
      hashTreeRoot(currentEpoch, Epoch).equals(ZERO_HASH)
      && body.randaoReveal.equals(EMPTY_SIGNATURE)
    );
  assert(randaoRevealVerified);

  // Mix it in
  state.latestRandaoMixes[currentEpoch % LATEST_RANDAO_MIXES_LENGTH] =
    xor(getRandaoMix(state, currentEpoch), hash(body.randaoReveal));
}
