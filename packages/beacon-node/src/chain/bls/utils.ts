import {type PublicKey, aggregatePublicKeys} from "@chainsafe/blst-ts";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";

export function getAggregatedPubkey(signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      return aggregatePublicKeys(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}

export function getAggregatedPubkeysCount(signatureSets: ISignatureSet[]): number {
  let pubkeysConut = 0;
  for (const set of signatureSets) {
    if (set.type === SignatureSetType.aggregate) {
      pubkeysConut += set.pubkeys.length;
    }
  }
  return pubkeysConut;
}
