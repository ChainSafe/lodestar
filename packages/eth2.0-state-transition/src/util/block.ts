import bls from "@chainsafe/bls";
import {signingRoot} from "@chainsafe/ssz";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, BeaconBlock, Validator} from "@chainsafe/eth2.0-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import { getBeaconProposerIndex } from "./proposer";

export function isValidBlockHeader(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verifySignature = true
): boolean {
  // Verify proposer is not slashed
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  if (proposer.slashed) {
    return false;
  }
  // verify signature
  if (verifySignature && !bls.verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlock, block),
    block.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER),
  )) {
    return false;
  }
  return true;
}
