/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {equals, signingRoot} from "@chainsafe/ssz";
import {verify} from "@chainsafe/bls";

import {BeaconState, ProposerSlashing,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../../constants";
import {computeEpochOfSlot, getCurrentEpoch, getDomain, isSlashableValidator, slashValidator,} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#proposer-slashings

export function processProposerSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true,
): void {
  const proposer = state.validators[proposerSlashing.proposerIndex];
  const header1Epoch = computeEpochOfSlot(config, proposerSlashing.header1.slot);
  const header2Epoch = computeEpochOfSlot(config, proposerSlashing.header2.slot);
  // Verify that the epoch is the same
  assert(header1Epoch === header2Epoch);
  // But the headers are different
  assert(!equals(config.types.BeaconBlockHeader, proposerSlashing.header1, proposerSlashing.header2));
  // Check proposer is slashable
  assert(isSlashableValidator(proposer, getCurrentEpoch(config, state)));
  // Signatures are valid
  const proposalData1Verified = !verifySignatures || verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlockHeader, proposerSlashing.header1),
    proposerSlashing.header1.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER, header1Epoch),
  );
  assert(proposalData1Verified);
  const proposalData2Verified = !verifySignatures || verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlockHeader, proposerSlashing.header2),
    proposerSlashing.header2.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER, header2Epoch),
  );
  assert(proposalData2Verified);
  slashValidator(config, state, proposerSlashing.proposerIndex);
}
