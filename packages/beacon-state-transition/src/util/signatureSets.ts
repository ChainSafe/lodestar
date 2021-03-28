import bls, {PublicKey} from "@chainsafe/bls";
import {BLSSignature, Root} from "@chainsafe/lodestar-types";

export enum SignatureSetType {
  single = "single",
  aggregate = "aggregate",
}

export type ISignatureSet =
  | {
      type: SignatureSetType.single;
      pubkey: PublicKey;
      signingRoot: Root;
      signature: BLSSignature;
    }
  | {
      type: SignatureSetType.aggregate;
      pubkeys: PublicKey[];
      signingRoot: Root;
      signature: BLSSignature;
    };

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
