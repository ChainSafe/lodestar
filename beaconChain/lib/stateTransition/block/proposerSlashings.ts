import assert from "assert";

import { treeHash} from "@chainsafesystems/ssz";

import {
  BeaconBlock,
  BeaconState,
  Validator,
} from "../../../types";

import {
  Domain,
  MAX_PROPOSER_SLASHINGS,
} from "../../../constants";

import {
  getCurrentEpoch,
  getDomain,
  slashValidator,
  slotToEpoch,
} from "../../../helpers/stateTransitionHelpers";

import {blsVerify} from "../../stubs/bls";

export default function processProposerSlashings(state: BeaconState, block: BeaconBlock) {
  assert(block.body.proposerSlashings.length <= MAX_PROPOSER_SLASHINGS);
  for (const proposerSlashing of block.body.proposerSlashings) {
    const proposer: Validator =
      state.validatorRegistry[proposerSlashing.proposerIndex.toNumber()];

    assert(proposerSlashing.proposalData1.slot.eq(proposerSlashing.proposalData2.slot));
    assert(proposerSlashing.proposalData1.shard.eq(proposerSlashing.proposalData2.shard));
    assert(proposerSlashing.proposalData1.blockRoot.equals(proposerSlashing.proposalData2.blockRoot));
    assert(proposer.slashedEpoch.gt(getCurrentEpoch(state)));
    const proposalData1Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData1),
      proposerSlashing.proposalSignature1,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData1.slot), Domain.PROPOSAL),
    );
    assert(proposalData1Verified);
    const proposalData2Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData2),
      proposerSlashing.proposalSignature2,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData2.slot), Domain.PROPOSAL),
    );
    assert(proposalData2Verified);
    slashValidator(state, proposerSlashing.proposerIndex);
  }
}
