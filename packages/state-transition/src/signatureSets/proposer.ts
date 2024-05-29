import {DOMAIN_BEACON_PROPOSER, ForkAll} from "@lodestar/params";
import {FullOrBlinded, SignedBeaconBlock, isBlindedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyProposerSignature(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock<ForkAll, FullOrBlinded>
): boolean {
  const signatureSet = getBlockProposerSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockProposerSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock<ForkAll, FullOrBlinded>
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

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
