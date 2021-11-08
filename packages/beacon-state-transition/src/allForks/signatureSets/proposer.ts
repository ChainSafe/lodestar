import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {computeSigningRoot} from "../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../../util/signatureSets";
import {CachedBeaconState, Index2PubkeyCache} from "../util";

export function verifyProposerSignature(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): boolean {
  const signatureSet = getProposerSignatureSet(state.config, state.epochCtx.index2pubkey, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getProposerSignatureSet(
  config: IBeaconConfig,
  index2pubkey: Index2PubkeyCache,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet {
  const domain = config.getDomain(DOMAIN_BEACON_PROPOSER, signedBlock.message.slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(
      config.getForkTypes(signedBlock.message.slot).BeaconBlock,
      signedBlock.message,
      domain
    ),
    signature: signedBlock.signature.valueOf() as Uint8Array,
  };
}
