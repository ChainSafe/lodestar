import {phase0} from "@chainsafe/lodestar-types";
import {computeSigningRoot, getDomain} from "../../../util";
import {DomainType} from "../../../constants";
import {EpochContext} from "../index";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";

export function verifyBlockSignature(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): boolean {
  const signatureSet = getBlockSignatureSet(epochCtx, state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockSignatureSet(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet {
  const config = epochCtx.config;
  const domain = getDomain(config, state, DomainType.BEACON_PROPOSER);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.phase0.BeaconBlock, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
