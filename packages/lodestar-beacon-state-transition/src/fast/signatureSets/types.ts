import {PublicKey} from "@chainsafe/bls";
import {BLSSignature, Root} from "@chainsafe/lodestar-types";

export type ISignatureSet = ISignatureSinglePubkeySet | ISignatureMultiplePubkeySet;

export interface ISignatureSinglePubkeySet {
  pubkey: PublicKey;
  signingRoot: Root;
  signature: BLSSignature;
}

export interface ISignatureMultiplePubkeySet {
  pubkeys: PublicKey[];
  signingRoot: Root;
  signature: BLSSignature;
}
