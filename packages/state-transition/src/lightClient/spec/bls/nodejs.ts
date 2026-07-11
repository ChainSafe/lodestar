import {PublicKey as BlstPublicKey, type PublicKey, Signature, fastAggregateVerify} from "@chainsafe/lodestar-z/blst";

export const blsImplementation = "lodestar-z";

export type {PublicKey};

export function deserializePublicKey(bytes: Uint8Array): PublicKey {
  return BlstPublicKey.fromBytes(bytes, true);
}

export function serializePublicKey(publicKey: PublicKey): Uint8Array {
  return publicKey.toBytes();
}

export function verifyAggregate(publicKeys: PublicKey[], message: Uint8Array, signature: Uint8Array): boolean {
  let sig: Signature;
  try {
    sig = Signature.fromBytes(signature, true);
  } catch (e) {
    throw new Error(`Error deserializing signature: ${e instanceof Error ? e.message : String(e)}`, {cause: e});
  }

  try {
    return fastAggregateVerify(message, publicKeys, sig);
  } catch (e) {
    throw new Error(`Error verifying signature: ${e instanceof Error ? e.message : String(e)}`, {cause: e});
  }
}
