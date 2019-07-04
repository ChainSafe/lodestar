/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {equals, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {
  BeaconState,
  ProposerSlashing,
  BeaconBlockHeader,
} from "../../../../types";

import {Domain} from "../../../../constants";

import {
  getCurrentEpoch,
  isSlashableValidator,
  slotToEpoch,
  slashValidator,
  getDomain,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#proposer-slashings

export function processProposerSlashing(
  state: BeaconState,
  proposerSlashing: ProposerSlashing
): BeaconState {
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
    getDomain(state, Domain.BEACON_PROPOSER, slotToEpoch(proposerSlashing.header1.slot)),
  );
  assert(proposalData1Verified);
  const proposalData2Verified = bls.verify(
    proposer.pubkey,
    signingRoot(proposerSlashing.header2, BeaconBlockHeader),
    proposerSlashing.header2.signature,
    getDomain(state, Domain.BEACON_PROPOSER, slotToEpoch(proposerSlashing.header2.slot)),
  );
  assert(proposalData2Verified);
  slashValidator(state, proposerSlashing.proposerIndex);
  return state;
}
