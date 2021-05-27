import {bls, CoordType, PublicKey} from "@chainsafe/bls";

const MIN_SET_COUNT_TO_BATCH = 2;

type SignatureSetDeserialized = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatch(sets: SignatureSetDeserialized[], validateSignature = true): boolean {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return bls.Signature.verifyMultipleSignatures(
      sets.map((s) => ({
        publicKey: s.publicKey,
        message: s.message,
        signature: bls.Signature.fromBytes(s.signature, CoordType.affine, validateSignature),
      }))
    );
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  return sets.every((set) => {
    const sig = bls.Signature.fromBytes(set.signature, CoordType.affine, validateSignature);
    return sig.verify(set.publicKey, set.message);
  });
}
