import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {computeSigningRoot, getDomain} from "../../util";
import {DomainType} from "../../constants";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";
import {CachedBeaconState} from "./cachedBeaconState";

export function verifyBlockSignature(cachedState: CachedBeaconState, signedBlock: SignedBeaconBlock): boolean {
  const signatureSet = getBlockSignatureSet(cachedState, signedBlock);
  return verifySignatureSet(signatureSet);
}

export function getBlockSignatureSet(cachedState: CachedBeaconState, signedBlock: SignedBeaconBlock): ISignatureSet {
  const config = cachedState.config;
  const domain = getDomain(config, cachedState, DomainType.BEACON_PROPOSER);

  return {
    type: SignatureSetType.single,
    pubkey: cachedState.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.BeaconBlock, signedBlock.message, domain),
    signature: signedBlock.signature,
  };
}
