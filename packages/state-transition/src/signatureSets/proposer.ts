import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, Slot, isBlindedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";

export function verifyProposerSignature(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): boolean {
  const signatureSet = getBlockProposerSignatureSet(config, index2pubkey, state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockProposerSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): ISignatureSet {
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

  const blockType = isBlindedBeaconBlock(signedBlock.message)
    ? config.getPostBellatrixForkTypes(signedBlock.message.slot).BlindedBeaconBlock
    : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}

export function getBlockHeaderProposerSignatureSetByParentStateSlot(
  index2pubkey: Index2PubkeyCache,
  parentState: CachedBeaconStateAllForks,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
) {
  return getBlockHeaderProposerSignatureSet(index2pubkey, parentState, signedBlockHeader, parentState.slot);
}

export function getBlockHeaderProposerSignatureSetByHeaderSlot(
  index2pubkey: Index2PubkeyCache,
  headState: CachedBeaconStateAllForks,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
) {
  return getBlockHeaderProposerSignatureSet(index2pubkey, headState, signedBlockHeader, signedBlockHeader.message.slot);
}

function getBlockHeaderProposerSignatureSet(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlockHeader: phase0.SignedBeaconBlockHeader,
  domainSlot: Slot
): ISignatureSet {
  const {config} = state;
  const domain = config.getDomain(domainSlot, DOMAIN_BEACON_PROPOSER, signedBlockHeader.message.slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedBlockHeader.message.proposerIndex],
    signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeader, signedBlockHeader.message, domain),
    signature: signedBlockHeader.signature,
  };
}
