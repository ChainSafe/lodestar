import {phase0} from "@chainsafe/lodestar-types";
import {computeSigningRoot, getDomain} from "../../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../../../util/signatureSets";
import {CachedBeaconState} from "./cachedBeaconState";

export function verifyBlockSignature(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): boolean {
  const signatureSet = getBlockSignatureSet(state, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockSignatureSet(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet {
  const {config, epochCtx} = state;
  const domain = getDomain(config, state, config.params.DOMAIN_BEACON_PROPOSER);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.phase0.BeaconBlock, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
