import {bls, PublicKey, Signature} from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";

export function verifySignatureSetsBatch(signatureSets: phase0.fast.ISignatureSet[]): boolean {
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

function getAggregatedPubkey(signatureSet: phase0.fast.ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case phase0.fast.SignatureSetType.single:
      return signatureSet.pubkey;

    case phase0.fast.SignatureSetType.aggregate:
      return bls.PublicKey.aggregate(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}
