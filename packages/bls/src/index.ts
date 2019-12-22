import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";
import {BLSPubkey, BLSSecretKey, BLSSignature, Domain, bytes32} from "@chainsafe/eth2.0-types";
import {PUBLIC_KEY_LENGTH} from "./constants";

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
  const keypair = new Keypair(PrivateKey.fromBytes(secretKey));
  return keypair.publicKey.toBytesCompressed();
}

/**
 * Signs given message using secret key.
 * @param secretKey
 * @param messageHash
 * @param domain
 */
export function sign(secretKey: BLSSecretKey, messageHash: bytes32, domain: Domain): BLSSignature {
  const privateKey = PrivateKey.fromBytes(secretKey);
  return privateKey.signMessage(messageHash, domain).toBytesCompressed();
}

/**
 * Compines all given signature into one.
 * @param signatures
 */
export function aggregateSignatures(signatures: BLSSignature[]): BLSSignature {
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
export function verify(publicKey: BLSPubkey, messageHash: bytes32, signature: BLSSignature, domain: Domain): boolean {
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
  messageHashes: bytes32[],
  signature: BLSSignature,
  domain: Domain
): boolean {
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
