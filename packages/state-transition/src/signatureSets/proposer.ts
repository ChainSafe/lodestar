import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, isBlindedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../types.js";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";

export function verifyProposerSignature(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): boolean {
  const signatureSet = getBlockProposerSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockProposerSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

  const blockType = isBlindedBeaconBlock(signedBlock.message)
    ? config.getExecutionForkTypes(signedBlock.message.slot).BlindedBeaconBlock
    : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}

export function getBlockHeaderProposerSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_PROPOSER, signedBlockHeader.message.slot);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlockHeader.message.proposerIndex],
    signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeader, signedBlockHeader.message, domain),
    signature: signedBlockHeader.signature,
  };
}
