import {bls, PublicKey} from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "@chainsafe/lodestar-beacon-state-transition";

export function getAggregatedPubkey(signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      return bls.PublicKey.aggregate(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}
