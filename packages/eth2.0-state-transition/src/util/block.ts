import bls from "@chainsafe/bls";
import {signingRoot} from "@chainsafe/ssz";

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, BeaconBlock, Validator} from "@chainsafe/eth2.0-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";

export function isValidBlockSignature(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  proposer: Validator
): boolean {
  if (!bls.verify(
    proposer.pubkey,
    signingRoot(config.types.BeaconBlock, block),
    block.signature,
    getDomain(config, state, DomainType.BEACON_PROPOSER),
  )) {
    return false;
  }
  return true;
}
