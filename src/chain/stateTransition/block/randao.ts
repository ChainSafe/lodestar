/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hashTreeRoot, hash} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {BeaconBlockBody, BeaconState} from "../../../types";
import {Domain} from "../../../constants";
import {BeaconConfig} from "../../../config";

import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#randao

export function processRandao(
  config: BeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const proposer = state.validatorRegistry[getBeaconProposerIndex(config, state)];
  // Verify that the provided randao value is valid
  assert(bls.verify(
    proposer.pubkey,
    hashTreeRoot(currentEpoch, config.types.Epoch),
    body.randaoReveal,
    getDomain(config, state, Domain.RANDAO),
  ));
  // Mix it in
  state.latestRandaoMixes[currentEpoch % config.params.LATEST_RANDAO_MIXES_LENGTH] =
    xor(getRandaoMix(config, state, currentEpoch), hash(body.randaoReveal));
}
