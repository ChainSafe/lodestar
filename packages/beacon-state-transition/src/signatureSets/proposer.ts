import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {allForks, ssz, bellatrix} from "@chainsafe/lodestar-types";
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
  const domain = state.config.getDomain(DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

  const blockType =
    (signedBlock.message as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader !== undefined
      ? ssz.bellatrix.BlindedBeaconBlock
      : config.getForkTypes(signedBlock.message.slot).BeaconBlock;

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(blockType, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
