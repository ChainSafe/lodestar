import {DOMAIN_BEACON_PROPOSER, DOMAIN_BLOB_SIDECAR} from "@lodestar/params";
import {allForks, isBlindedBeaconBlock, isBlindedBlobSidecar, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/signatureSets.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyProposerSignature(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.FullOrBlindedSignedBeaconBlock
): boolean {
  const signatureSet = getBlockProposerSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockProposerSignatureSet(
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

export function getBlobProposerSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBlob: allForks.FullOrBlindedSignedBlobSidecar
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = config.getDomain(state.slot, DOMAIN_BLOB_SIDECAR, signedBlob.message.slot);

  const blockType = isBlindedBlobSidecar(signedBlob.message) ? ssz.deneb.BlindedBlobSidecar : ssz.deneb.BlobSidecar;

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlob.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlob.message, domain),
    signature: signedBlob.signature,
  };
}
