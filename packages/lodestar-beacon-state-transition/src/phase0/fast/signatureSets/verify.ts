import bls from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "./types";

export function verifySignatureSet(signatureSet: ISignatureSet): boolean {
  const signature = bls.Signature.fromBytes(signatureSet.signature.valueOf() as Uint8Array);

  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signature.verify(signatureSet.pubkey, signatureSet.signingRoot as Uint8Array);

    case SignatureSetType.aggregate:
      return signature.verifyAggregate(signatureSet.pubkeys, signatureSet.signingRoot as Uint8Array);

    default:
      throw Error("Unknown signature set type");
  }
}
