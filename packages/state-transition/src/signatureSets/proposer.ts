import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, Slot, isBlindedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";

export function verifyProposerSignature(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): boolean {
  const signatureSet = getBlockProposerSignatureSet(config, signedBlock);
  return verifySignatureSet(signatureSet, index2pubkey);
}

export function getBlockProposerSignatureSet(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): ISignatureSet {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  const domain = config.getDomain(blockSlot, DOMAIN_BEACON_PROPOSER, blockSlot);

  const blockType = isBlindedBeaconBlock(signedBlock.message)
    ? config.getPostBellatrixForkTypes(signedBlock.message.slot).BlindedBeaconBlock
    : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.indexed,
    index: signedBlock.message.proposerIndex,
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}

export function getBlockHeaderProposerSignatureSetByParentStateSlot(
  config: BeaconConfig,
  parentStateSlot: Slot,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
) {
  return getBlockHeaderProposerSignatureSet(config, signedBlockHeader, parentStateSlot);
}

export function getBlockHeaderProposerSignatureSetByHeaderSlot(
  config: BeaconConfig,
  signedBlockHeader: phase0.SignedBeaconBlockHeader
) {
  return getBlockHeaderProposerSignatureSet(config, signedBlockHeader, signedBlockHeader.message.slot);
}

function getBlockHeaderProposerSignatureSet(
  config: BeaconConfig,
  signedBlockHeader: phase0.SignedBeaconBlockHeader,
  domainSlot: Slot
): ISignatureSet {
  const domain = config.getDomain(domainSlot, DOMAIN_BEACON_PROPOSER, signedBlockHeader.message.slot);

  return {
    type: SignatureSetType.indexed,
    index: signedBlockHeader.message.proposerIndex,
    signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeader, signedBlockHeader.message, domain),
    signature: signedBlockHeader.signature,
  };
}
