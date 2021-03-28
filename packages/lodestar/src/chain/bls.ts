import {bls, PublicKey, Signature} from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "@chainsafe/lodestar-beacon-state-transition";

export function verifySignatureSetsBatch(signatureSets: ISignatureSet[]): boolean {
  const publicKeys: PublicKey[] = [];
  const messages: Uint8Array[] = [];
  const signatures: Signature[] = [];

  for (const signatureSet of signatureSets) {
    publicKeys.push(getAggregatedPubkey(signatureSet));
    messages.push(signatureSet.signingRoot as Uint8Array);
    signatures.push(bls.Signature.fromBytes(signatureSet.signature.valueOf() as Uint8Array));
  }

  return bls.Signature.verifyMultipleSignatures(publicKeys, messages, signatures);
}

function getAggregatedPubkey(signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      return bls.PublicKey.aggregate(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}
