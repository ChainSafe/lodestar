/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hashTreeRoot, hash} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {BeaconBlock, BeaconBlockBody, BeaconState, Epoch,} from "../../../../types";

import {Domain, EMPTY_SIGNATURE, LATEST_RANDAO_MIXES_LENGTH, ZERO_HASH,} from "../../../../../eth2-types/src/constants";

import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#randao

export function processRandao(state: BeaconState, body: BeaconBlockBody): void {
  const currentEpoch = getCurrentEpoch(state);
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state)];
  // Verify that the provided randao value is valid
  assert(bls.verify(
    proposer.pubkey,
    hashTreeRoot(currentEpoch, Epoch),
    body.randaoReveal,
    getDomain(state, Domain.RANDAO),
  ));
  // Mix it in
  state.latestRandaoMixes[currentEpoch % LATEST_RANDAO_MIXES_LENGTH] =
    xor(getRandaoMix(state, currentEpoch), hash(body.randaoReveal));
}
