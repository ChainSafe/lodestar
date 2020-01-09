import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";
import {BLSPubkey, BLSSecretKey, BLSSignature, Domain, Hash} from "@chainsafe/eth2.0-types";
import {PUBLIC_KEY_LENGTH} from "./constants";
import assert from "assert";

export {Keypair, PrivateKey, PublicKey, Signature};

export {init as initBLS} from "./context";

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
export function generatePublicKey(secretKey: BLSSecretKey): BLSPubkey {
  assert(secretKey, "secretKey is null or undefined");
  const keypair = new Keypair(PrivateKey.fromBytes(secretKey));
  return keypair.publicKey.toBytesCompressed();
}

/**
 * Signs given message using secret key.
 * @param secretKey
 * @param messageHash
 * @param domain
 */
export function sign(secretKey: BLSSecretKey, messageHash: Hash, domain: Domain): BLSSignature {
  assert(secretKey, "secretKey is null or undefined");
  assert(messageHash, "messageHash is null or undefined");
  assert(domain, "domain is null or undefined");
  const privateKey = PrivateKey.fromBytes(secretKey);
  return privateKey.signMessage(messageHash, domain).toBytesCompressed();
}

/**
 * Compines all given signature into one.
 * @param signatures
 */
export function aggregateSignatures(signatures: BLSSignature[]): BLSSignature {
  assert(signatures, "signatures is null or undefined");
  return signatures.map((signature): Signature => {
    return Signature.fromCompressedBytes(signature);
  }).reduce((previousValue, currentValue): Signature => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

/**
 * Combines all given public keys into single one
 * @param publicKeys
 */
export function aggregatePubkeys(publicKeys: BLSPubkey[]): BLSPubkey {
  assert(publicKeys, "publicKeys is null or undefined");
  if(publicKeys.length === 0) {
    return Buffer.alloc(PUBLIC_KEY_LENGTH);
  }
  return publicKeys.map(PublicKey.fromBytes).reduce((agg, pubKey) => {
    if(agg) {
      return agg.add(pubKey);
    } else {
      return pubKey;
    }
  }
  ).toBytesCompressed();
}

/**
 * Verifies if signature is message signed with given public key.
 * @param publicKey
 * @param messageHash
 * @param signature
 * @param domain
 */
export function verify(publicKey: BLSPubkey, messageHash: Hash, signature: BLSSignature, domain: Domain): boolean {
  assert(publicKey, "publicKey is null or undefined");
  assert(messageHash, "messageHash is null or undefined");
  assert(signature, "signature is null or undefined");
  assert(domain, "domain is null or undefined");
  try {
    return PublicKey
      .fromBytes(publicKey)
      .verifyMessage(Signature.fromCompressedBytes(signature), messageHash, domain);
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
  publicKeys: BLSPubkey[],
  messageHashes: Hash[],
  signature: BLSSignature,
  domain: Domain
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
      .fromCompressedBytes(signature)
      .verifyMultiple(
        publicKeys.map((key) => PublicKey.fromBytes(key)),
        messageHashes,
        domain
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
