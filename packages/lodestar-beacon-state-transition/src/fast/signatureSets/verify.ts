import bls from "@chainsafe/bls";
import {ISignatureSet} from "./types";

export function verifySignatureSet(signatureSet: ISignatureSet): boolean {
  const signature = bls.Signature.fromBytes(signatureSet.signature.valueOf() as Uint8Array);

  switch (signatureSet.type) {
    case "single-pubkey":
      return signature.verify(signatureSet.pubkey, signatureSet.signingRoot as Uint8Array);
    case "multiple-pubkeys":
      return signature.verifyAggregate(signatureSet.pubkeys, signatureSet.signingRoot as Uint8Array);
    default:
      throw Error("Unknown signature set type");
  }
}
