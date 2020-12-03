import bls from "@chainsafe/bls";
import {ISignatureMultiplePubkeySet, ISignatureSinglePubkeySet} from "./types";

export function verifySinglePubkeySet(signatureSet: ISignatureSinglePubkeySet): boolean {
  const signature = bls.Signature.fromBytes(signatureSet.signature.valueOf() as Uint8Array);
  return signature.verify(signatureSet.pubkey, signatureSet.signingRoot as Uint8Array);
}

export function verifyMultilePubkeySet(signatureSet: ISignatureMultiplePubkeySet): boolean {
  const signature = bls.Signature.fromBytes(signatureSet.signature.valueOf() as Uint8Array);
  return signature.verifyAggregate(signatureSet.pubkeys, signatureSet.signingRoot as Uint8Array);
}
