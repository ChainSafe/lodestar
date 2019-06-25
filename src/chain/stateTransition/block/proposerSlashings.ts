/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {equals, serialize, signingRoot} from "@chainsafe/ssz";


import {
  BeaconBlock,
  BeaconState,
  ProposerSlashing,
  BeaconBlockHeader,
} from "../../../types";

import {
  Domain,
  MAX_PROPOSER_SLASHINGS,
} from "../../../constants";

import {
  getCurrentEpoch,
  getDomain,
  isSlashableValidator,
  slotToEpoch,
  slashValidator, getDomainFromFork,
} from "../util";

import bls from "@chainsafe/bls-js";


export function processProposerSlashing(state: BeaconState, proposerSlashing: ProposerSlashing): BeaconState {
  const proposer = state.validatorRegistry[proposerSlashing.proposerIndex];
  // Verify that the epoch is the same
  assert(slotToEpoch(proposerSlashing.header1.slot) === slotToEpoch(proposerSlashing.header2.slot));
  // But the headers are different

  assert(!equals(proposerSlashing.header1, proposerSlashing.header2, BeaconBlockHeader));
  // Check proposer is slashable
  assert(isSlashableValidator(proposer, getCurrentEpoch(state)));
  // Signatures are valid
  const proposalData1Verified = bls.verify(
    proposer.pubkey,
    signingRoot(proposerSlashing.header1, BeaconBlockHeader),
    proposerSlashing.header1.signature,
    getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header1.slot), Domain.BEACON_PROPOSER),
  );
  assert(proposalData1Verified);
  const proposalData2Verified = bls.verify(
    proposer.pubkey,
    signingRoot(proposerSlashing.header2, BeaconBlockHeader),
    proposerSlashing.header2.signature,
    getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header2.slot), Domain.BEACON_PROPOSER),
  );
  assert(proposalData2Verified);
  slashValidator(state, proposerSlashing.proposerIndex);
  return state;
}

export default function processProposerSlashings(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.proposerSlashings.length <= MAX_PROPOSER_SLASHINGS);
  for (const proposerSlashing of block.body.proposerSlashings) {
    processProposerSlashing(state, proposerSlashing);
  }
}
