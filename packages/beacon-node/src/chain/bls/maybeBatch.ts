import blstTs from "blst-ts-test";
import bls from "@chainsafe/bls";
import {CoordType, PublicKey} from "@chainsafe/bls/types";

const MIN_SET_COUNT_TO_BATCH = 2;

export type SignatureSetDeserialized = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

export type NapiSignatureSetDeserialized = {
  publicKey: blstTs.PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatchSync(sets: SignatureSetDeserialized[]): boolean {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return bls.Signature.verifyMultipleSignatures(
      sets.map((s) => ({
        publicKey: s.publicKey,
        message: s.message,
        // true = validate signature
        signature: bls.Signature.fromBytes(s.signature, CoordType.affine, true),
      }))
    );
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  return sets.every((set) => {
    // true = validate signature
    const sig = bls.Signature.fromBytes(set.signature, CoordType.affine, true);
    return sig.verify(set.publicKey, set.message);
  });
}

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export async function verifySignatureSetsMaybeBatch(sets: NapiSignatureSetDeserialized[]): Promise<boolean> {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return blstTs.verifyMultipleAggregateSignatures(
      sets.map((s) => ({
        msg: s.message,
        publicKey: s.publicKey,
        signature: blstTs.Signature.deserialize(s.signature, blstTs.CoordType.affine),
      }))
    );
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  const verifyPromises: Promise<boolean>[] = [];
  for (const set of sets) {
    const sig = blstTs.Signature.deserialize(set.signature, blstTs.CoordType.affine);
    verifyPromises.push(sig.sigValidate().then(() => blstTs.verify(set.message, set.publicKey, sig)));
  }

  return (await Promise.all(verifyPromises)).every((v) => v);
}
