import {PublicKey} from "@chainsafe/bls";
import {BLSSignature, Root} from "@chainsafe/lodestar-types";

export type ISignatureSet = ISignatureSinglePubkeySet | ISignatureMultiplePubkeySet;

interface ISignatureSinglePubkeySet {
  type: "single-pubkey";
  pubkey: PublicKey;
  signingRoot: Root;
  signature: BLSSignature;
}

interface ISignatureMultiplePubkeySet {
  type: "multiple-pubkeys";
  pubkeys: PublicKey[];
  signingRoot: Root;
  signature: BLSSignature;
}
