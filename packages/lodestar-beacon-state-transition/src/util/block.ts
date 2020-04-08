import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import {getBeaconProposerIndex} from "./proposer";
import {computeSigningRoot} from "./signingRoot";

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
  const domain = getDomain(config, state, DomainType.BEACON_PROPOSER);
  const signingRoot = computeSigningRoot(config, config.types.BeaconBlock, signedBlock.message, domain);
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedBlock.signature.valueOf() as Uint8Array,
  );
}
