import {PublicKey} from "@chainsafe/bls";
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
