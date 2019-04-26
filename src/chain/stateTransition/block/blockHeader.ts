import assert from "assert";

import {signingRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  BeaconBlockHeader,
} from "../../../types";

import {Domain} from "../../../constants";

import {blsVerify} from "../../../stubs/bls";

import {
  getBeaconProposerIndex,
  getDomain,
  getTemporaryBlockHeader,
} from "../util";


export default function processBlockHeader(state: BeaconState, block: BeaconBlock): void {
  // Verify that the slots match
  assert(block.slot === state.slot);

  // Verify that the parent matches
  assert(block.previousBlockRoot.equals(signingRoot(state.latestBlockHeader, BeaconBlockHeader)));

  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(block);

  // Verify proposer is not slashed
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state)];
  assert(!proposer.slashed);

  // Verify proposer signature
  assert(blsVerify(
    state.validatorRegistry[getBeaconProposerIndex(state)].pubkey,
    signingRoot(block, BeaconBlock),
    block.signature,
    getDomain(state, Domain.BEACON_PROPOSER),
  ));
}
