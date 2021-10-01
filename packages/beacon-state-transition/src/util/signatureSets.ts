import bls, {PublicKey} from "@chainsafe/bls";
import {Root} from "@chainsafe/lodestar-types";

export enum SignatureSetType {
  single = "single",
  aggregate = "aggregate",
}

export type ISignatureSet =
  | {
      type: SignatureSetType.single;
      pubkey: PublicKey;
      signingRoot: Root;
      signature: Uint8Array;
    }
  | {
      type: SignatureSetType.aggregate;
      pubkeys: PublicKey[];
      signingRoot: Root;
      signature: Uint8Array;
    };

export function verifySignatureSet(signatureSet: ISignatureSet): boolean {
  // All signatures are not trusted and must be group checked (p2.subgroup_check)
  const signature = bls.Signature.fromBytes(signatureSet.signature, undefined, true);

  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signature.verify(signatureSet.pubkey, signatureSet.signingRoot.valueOf() as Uint8Array);

    case SignatureSetType.aggregate:
      return signature.verifyAggregate(signatureSet.pubkeys, signatureSet.signingRoot.valueOf() as Uint8Array);

    default:
      throw Error("Unknown signature set type");
  }
}
