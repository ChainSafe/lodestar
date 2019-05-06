import {BLSDomain, BLSSecretKey, BLSPubkey, BLSSignature, bytes32} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";
import {G1point} from "./helpers/g1point";

/**
 * Generates new secret and public key
 */
function generateKeyPair(): Keypair {
  return new Keypair(PrivateKey.random());
}

/**
 * Generates public key from given secret.
 * @param {BLSSecretKey} secretKey
 */
function generatePublicKey(secretKey: BLSSecretKey): BLSPubkey {
  const keypair = new Keypair(PrivateKey.fromBytes(secretKey));
  return keypair.publicKey.toBytesCompressed();
}

/**
 * Signs given message using secret key.
 * @param secretKey
 * @param messageHash
 * @param domain
 */
function sign(secretKey: BLSSecretKey, messageHash: bytes32, domain: BLSDomain): BLSSignature {
  const privateKey = PrivateKey.fromBytes(secretKey);
  const hash = G2point.hashToG2(messageHash, domain);
  return privateKey.sign(hash).toBytesCompressed();
}

/**
 * Compines all given signature into one.
 * @param signatures
 */
function aggregateSignatures(signatures: BLSSignature[]): BLSSignature {
  return signatures.map((signature): G2point => {
    return G2point.fromCompressedBytes(signature)
  }).reduce((previousValue, currentValue): G2point => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

/**
 * Combines all given public keys into single one
 * @param publicKeys
 */
function aggregatePubkeys(publicKeys: BLSPubkey[]): BLSPubkey {
  return publicKeys.map((publicKey): G1point => {
    return G1point.fromBytesCompressed(publicKey)
  }).reduce((previousValue, currentValue): G1point => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

export default {
  generateKeyPair,
  generatePublicKey,
  sign,
  aggregateSignatures,
  aggregatePubkeys
}
