/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {signingRoot} from "@chainsafe/ssz";

import bls from "@chainsafe/bls-js";

import {
  BeaconBlock,
  BeaconState,
} from "@chainsafe/eth2-types";
import {IBeaconConfig} from "../../../config";
import {Domain} from "../../../constants";

import {
  getBeaconProposerIndex,
  getDomain,
  getTemporaryBlockHeader,
} from "../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#block-header

export function processBlockHeader(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verify: boolean = true
): void {
  // Verify that the slots match
  assert(block.slot === state.slot);

  // Verify that the parent matches
  assert(block.parentRoot.equals(signingRoot(state.latestBlockHeader, config.types.BeaconBlockHeader)));
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);

  // Verify proposer is not slashed
  const proposer = state.validatorRegistry[getBeaconProposerIndex(config, state)];
  assert(!proposer.slashed);

  if(verify) {
    // Verify proposer signature
    assert(bls.verify(
      proposer.pubkey,
      signingRoot(block, config.types.BeaconBlock),
      block.signature,
      getDomain(config, state, Domain.BEACON_PROPOSER),
    ));
  }
}
