/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {signingRoot} from "@chainsafe/ssz";
import {BeaconBlock, BeaconState,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {getTemporaryBlockHeader, isValidBlockSignature, getBeaconProposerIndex} from "../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#block-header

export function processBlockHeader(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verifyProposer = true
): void {
  // Verify that the slots match
  assert(block.slot === state.slot);
  // Verify that the parent matches
  assert(block.parentRoot.equals(signingRoot(config.types.BeaconBlockHeader, state.latestBlockHeader)));
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);
  // Verify proposer is not slashed
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  assert(!proposer.slashed);

  if(verifyProposer) {
    assert(isValidBlockSignature(config, state, block, proposer));
  }
}
