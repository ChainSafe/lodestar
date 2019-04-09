import assert from "assert";

import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  bytes32,
  ProposalSignedData,
} from "../../../types";

import {
  BEACON_CHAIN_SHARD_NUMBER,
  Domain,
  EMPTY_SIGNATURE,
} from "../../../constants";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
} from "../../helpers/stateTransitionHelpers";

import {blsVerify} from "../../../stubs/bls";

export default function processProposerSignature(state: BeaconState, block: BeaconBlock): void {
  const b: BeaconBlock = {
    ...block,
    signature: EMPTY_SIGNATURE,
  };
  const blockWithoutSignatureRoot: bytes32 = hashTreeRoot(b, BeaconBlock);

  const p: ProposalSignedData = {
    slot: state.slot,
    shard: 2**32, // TODO this will get removed in update to more recent spec
    blockRoot: blockWithoutSignatureRoot,
  };
  const proposalRoot = hashTreeRoot(p, ProposalSignedData);

  const blockSignatureVerified = blsVerify(
    state.validatorRegistry[getBeaconProposerIndex(state, state.slot)].pubkey,
    proposalRoot,
    block.signature,
    getDomain(state.fork, getCurrentEpoch(state), Domain.PROPOSAL),
  );

  assert(blockSignatureVerified);
}
