import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, Slot, isBlindedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.ts";
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
    ? config.getPostBellatrixForkTypes(signedBlock.message.slot).BlindedBeaconBlock
    : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}

export function getBlockHeaderProposerSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  parentSlot: Slot,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
): ISignatureSet {
  const domain = config.getDomain(parentSlot, DOMAIN_BEACON_PROPOSER, signedBlockHeader.message.slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedBlockHeader.message.proposerIndex],
    signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeader, signedBlockHeader.message, domain),
    signature: signedBlockHeader.signature,
  };
}

export function getBlockHeaderProposerSignatureSetFromParentState(
  parentState: CachedBeaconStateAllForks,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
): ISignatureSet {
  return getBlockHeaderProposerSignatureSet(
    parentState.config,
    parentState.epochCtx.index2pubkey,
    parentState.slot,
    signedBlockHeader
  );
}
