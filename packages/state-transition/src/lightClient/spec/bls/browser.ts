import bls from "@chainsafe/bls/herumi";
import type {PublicKey, Signature} from "@chainsafe/bls/types";

export const blsImplementation = "herumi";

export type {PublicKey};

export function deserializePublicKey(bytes: Uint8Array): PublicKey {
  return bls.PublicKey.fromBytes(bytes);
}

export function serializePublicKey(publicKey: PublicKey): Uint8Array {
  return publicKey.toBytes();
}

export function verifyAggregate(publicKeys: PublicKey[], message: Uint8Array, signature: Uint8Array): boolean {
  let aggregatePubkey: PublicKey;
  try {
    aggregatePubkey = bls.PublicKey.aggregate(publicKeys);
  } catch (e) {
    throw new Error(`Error aggregating pubkeys: ${e instanceof Error ? e.message : String(e)}`, {cause: e});
  }

  let sig: Signature;
  try {
    sig = bls.Signature.fromBytes(signature, undefined, true);
  } catch (e) {
    throw new Error(`Error deserializing signature: ${e instanceof Error ? e.message : String(e)}`, {cause: e});
  }

  try {
    return sig.verify(aggregatePubkey, message);
  } catch (e) {
    throw new Error(`Error verifying signature: ${e instanceof Error ? e.message : String(e)}`, {cause: e});
  }
}
