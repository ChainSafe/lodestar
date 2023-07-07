import {CoordType, PublicKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";

const MIN_SET_COUNT_TO_BATCH = 2;

export type SignatureSetDeserialized = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatch(sets: SignatureSetDeserialized[], isSameMessage = false): boolean {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    if (isSameMessage) {
      // Consumers need to make sure that all sets have the same message
      const aggregatedPubkey = bls.PublicKey.aggregate(sets.map((set) => set.publicKey));
      const aggregatedSignature = bls.Signature.aggregate(
        // As of Jul 2023 we could skip the signature validation here, no attack scenario found
        // however this does not have the same security guarantee as the regular verify
        sets.map((set) => bls.Signature.fromBytes(set.signature, CoordType.affine, false))
      );
      return aggregatedSignature.verify(aggregatedPubkey, sets[0].message);
    }

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
