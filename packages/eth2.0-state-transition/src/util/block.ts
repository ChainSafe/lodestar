import bls from "@chainsafe/bls";
import {signingRoot} from "@chainsafe/ssz";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, BeaconBlock} from "@chainsafe/eth2.0-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import {getBeaconProposerIndex} from "./proposer";

export function isValidBlockSignature(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
): boolean {
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  if (proposer.slashed) {
    return false;
  }

  if (!bls.verify(
    proposer.pubkey,
    signingRoot(block, config.types.BeaconBlock),
    block.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER),
  )) {
    return false;
  }
  return true;
}