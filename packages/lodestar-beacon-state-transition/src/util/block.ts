import bls, {Signature} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {DomainType} from "../constants";
import {computeSigningRoot} from "./signingRoot";
import {EpochContext} from "../fast";

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
): boolean {
  const domain = getDomain(config, state, DomainType.BEACON_PROPOSER);
  const signingRoot = computeSigningRoot(config, config.types.BeaconBlock, signedBlock.message, domain);
  const proposer = state.validators[signedBlock.message.proposerIndex];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedBlock.signature.valueOf() as Uint8Array,
  );
}

export function verifyBlockSignatureFast(
  context: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
): boolean {
  const domain = getDomain(context.config, state, DomainType.BEACON_PROPOSER);
  const signingRoot = computeSigningRoot(context.config, context.config.types.BeaconBlock, signedBlock.message, domain);
  return context
    .index2pubkey[signedBlock.message.proposerIndex]
    .verifyMessage(
      Signature.fromCompressedBytes(signedBlock.signature.valueOf() as Uint8Array),
      signingRoot
    );
}
