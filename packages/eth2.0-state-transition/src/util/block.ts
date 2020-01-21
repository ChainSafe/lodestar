import bls from "@chainsafe/bls";
import {hashTreeRoot} from "@chainsafe/ssz";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import {getBeaconProposerIndex} from "./proposer";

export function isValidProposer(
  config: IBeaconConfig,
  state: BeaconState,
): boolean {
  // Verify proposer is not slashed
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  return proposer.slashed;
}

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
): boolean {
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  return bls.verify(
    proposer.pubkey,
    hashTreeRoot(config.types.BeaconBlock, signedBlock.message),
    signedBlock.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER),
  );
}
