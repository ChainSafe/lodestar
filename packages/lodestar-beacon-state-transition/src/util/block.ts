import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import {getBeaconProposerIndex} from "./proposer";

export function isValidProposer(
  config: IBeaconConfig,
  state: BeaconState,
): boolean {
  // Verify proposer is not slashed
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  return !proposer.slashed;
}

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
): boolean {
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    config.types.BeaconBlock.hashTreeRoot(signedBlock.message),
    signedBlock.signature.valueOf() as Uint8Array,
    getDomain(config, state, DomainType.BEACON_PROPOSER),
  );
}
