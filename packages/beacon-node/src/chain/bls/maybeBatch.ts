import blstTs from "blst-ts";
import {CoordType, PublicKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";

const MIN_SET_COUNT_TO_BATCH = 2;

export type SignatureSetDeserialized = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

export type SignatureSetSerialized = {
  publicKey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatch(sets: SignatureSetDeserialized[]): boolean {
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

export async function asyncVerifySignatureSetsMaybeBatch(sets: SignatureSetSerialized[]): Promise<boolean> {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return blstTs.verifyMultipleAggregateSignatures(
      sets.map((s) => ({
        publicKey: s.publicKey,
        msg: s.message,
        signature: s.signature,
      }))
    );
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  return (await Promise.all(sets.map((set) => blstTs.verify(set.message, set.publicKey, set.signature)))).every(
    (v) => !!v
  );
}
