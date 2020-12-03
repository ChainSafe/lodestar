import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {computeSigningRoot, getDomain} from "../../util";
import {DomainType} from "../../constants";
import {EpochContext} from "../index";
import {ISignatureSinglePubkeySet, verifySinglePubkeySet} from "../signatureSets";

export function verifyBlockSignature(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): boolean {
  const signatureSet = getBlockSignatureSet(epochCtx, state, signedBlock);
  return verifySinglePubkeySet(signatureSet);
}

export function getBlockSignatureSet(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSinglePubkeySet {
  const config = epochCtx.config;
  const domain = getDomain(config, state, DomainType.BEACON_PROPOSER);

  return {
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.BeaconBlock, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
