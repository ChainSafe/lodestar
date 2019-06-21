/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {signingRoot} from "@chainsafe/ssz";

import bls from "@chainsafe/bls-js";

import {
  BeaconBlock,
  BeaconState,
  BeaconBlockHeader,
} from "../../../types";

import {Domain} from "../../../constants";

import {
  getBeaconProposerIndex,
  getDomain,
  getTemporaryBlockHeader,
} from "../util";


export default function processBlockHeader(state: BeaconState, block: BeaconBlock, verify: boolean = true): void {
  // Verify that the slots match
  assert(block.slot === state.slot);

  // Verify that the parent matches
  assert(block.parentRoot.equals(signingRoot(state.latestBlockHeader, BeaconBlockHeader)));
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(block);

  // Verify proposer is not slashed
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state)];
  assert(!proposer.slashed);

  if(verify) {
    // Verify proposer signature
    assert(bls.verify(
      proposer.pubkey,
      signingRoot(block, BeaconBlock),
      block.signature,
      getDomain(state, Domain.BEACON_PROPOSER),
    ));
  }
}
