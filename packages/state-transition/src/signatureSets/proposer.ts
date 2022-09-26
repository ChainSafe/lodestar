import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {allForks, isBlindedBeaconBlock} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyProposerSignature(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.FullOrBlindedSignedBeaconBlock
): boolean {
  const signatureSet = getProposerSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getProposerSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.FullOrBlindedSignedBeaconBlock
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

  const blockType = isBlindedBeaconBlock(signedBlock.message)
    ? config.getBlindedForkTypes(signedBlock.message.slot).BeaconBlock
    : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
