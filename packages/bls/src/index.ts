import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";
import {PUBLIC_KEY_LENGTH} from "./constants";
import assert from "assert";

export {Keypair, PrivateKey, PublicKey, Signature};

export {init as initBLS} from "./context";

function toBuffer(input: Uint8Array): Buffer {
  return Buffer.from(input.buffer, input.byteOffset, input.length);
}

/**
 * Generates new secret and public key
 */
export function generateKeyPair(): Keypair {
  return Keypair.generate();
}

/**
 * Generates public key from given secret.
 * @param {BLSSecretKey} secretKey
 */
export function generatePublicKey(secretKey: Uint8Array): Buffer {
  assert(secretKey, "secretKey is null or undefined");
  const keypair = new Keypair(PrivateKey.fromBytes(toBuffer(secretKey)));
  return keypair.publicKey.toBytesCompressed();
}

/**
 * Signs given message using secret key.
 * @param secretKey
 * @param messageHash
 * @param domain
 */
export function sign(secretKey: Uint8Array, messageHash: Uint8Array, domain: Uint8Array): Buffer {
  assert(secretKey, "secretKey is null or undefined");
  assert(messageHash, "messageHash is null or undefined");
  assert(domain, "domain is null or undefined");
  const privateKey = PrivateKey.fromBytes(toBuffer(secretKey));
  return privateKey.signMessage(
    toBuffer(messageHash),
    toBuffer(domain),
  ).toBytesCompressed();
}

/**
 * Compines all given signature into one.
 * @param signatures
 */
export function aggregateSignatures(signatures: Uint8Array[]): Buffer {
  assert(signatures, "signatures is null or undefined");
  return signatures.map((signature): Signature => {
    return Signature.fromCompressedBytes(toBuffer(signature));
  }).reduce((previousValue, currentValue): Signature => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

/**
 * Combines all given public keys into single one
 * @param publicKeys
 */
export function aggregatePubkeys(publicKeys: Uint8Array[]): Buffer {
  assert(publicKeys, "publicKeys is null or undefined");
  if(publicKeys.length === 0) {
    return Buffer.alloc(PUBLIC_KEY_LENGTH);
  }
  return publicKeys
    .map((p) => PublicKey.fromBytes(toBuffer(p)))
    .reduce((agg, pubKey) => agg.add(pubKey))
    .toBytesCompressed();
}

/**
 * Verifies if signature is message signed with given public key.
 * @param publicKey
 * @param messageHash
 * @param signature
 * @param domain
 */
export function verify(
  publicKey: Uint8Array,
  messageHash: Uint8Array,
  signature: Uint8Array,
  domain: Uint8Array
): boolean {
  assert(publicKey, "publicKey is null or undefined");
  assert(messageHash, "messageHash is null or undefined");
  assert(signature, "signature is null or undefined");
  assert(domain, "domain is null or undefined");
  try {
    return PublicKey
      .fromBytes(toBuffer(publicKey))
      .verifyMessage(
        Signature.fromCompressedBytes(toBuffer(signature)),
        toBuffer(messageHash),
        toBuffer(domain)
      );
  } catch (e) {
    return false;
  }
}

/**
 * Verifies if signature is list of message signed with corresponding public key.
 * @param publicKeys
 * @param messageHashes
 * @param signature
 * @param domain
 */
export function verifyMultiple(
  publicKeys: Uint8Array[],
  messageHashes: Uint8Array[],
  signature: Uint8Array,
  domain: Uint8Array
): boolean {
  assert(publicKeys, "publicKey is null or undefined");
  assert(messageHashes, "messageHash is null or undefined");
  assert(signature, "signature is null or undefined");
  assert(domain, "domain is null or undefined");

  if(publicKeys.length === 0 || publicKeys.length != messageHashes.length) {
    return false;
  }
  try {
    return Signature
      .fromCompressedBytes(toBuffer(signature))
      .verifyMultiple(
        publicKeys.map((key) => PublicKey.fromBytes(toBuffer(key))),
        messageHashes.map((m) => toBuffer(m)),
        toBuffer(domain),
      );
  } catch (e) {
    return false;
  }
}

export default {
  generateKeyPair,
  generatePublicKey,
  sign,
  aggregateSignatures,
  aggregatePubkeys,
  verify,
  verifyMultiple
};
