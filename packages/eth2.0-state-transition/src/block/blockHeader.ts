/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {signingRoot} from "@chainsafe/ssz";
import {BeaconBlock, BeaconState,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {getTemporaryBlockHeader, isValidBlockHeader, getBeaconProposerIndex} from "../util";

export function processBlockHeader(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verifySignature = true
): void {
  // Verify that the slots match
  assert(block.slot === state.slot);
  // Verify that the parent matches
  assert(block.parentRoot.equals(signingRoot(config.types.BeaconBlockHeader, state.latestBlockHeader)));
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);

  assert(isValidBlockHeader(config, state, block, verifySignature));
}
