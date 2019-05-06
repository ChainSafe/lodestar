import {BLSDomain, BLSSecretKey, BLSPubkey, BLSSignature, bytes32} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";
import {G1point} from "./helpers/g1point";

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
function aggregateSignatures(signatures: BLSSignature[]) : BLSSignature {
  return signatures.map((signature) => {
    return G2point.fromCompressedBytes(signature)
  }).reduce((previousValue, currentValue) => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

/**
 * Combines all given public keys into single one
 * @param publicKeys
 */
function aggregatePubkeys(publicKeys: BLSPubkey[]) : BLSPubkey {
  return publicKeys.map((publicKey) => {
    return G1point.fromBytesCompressed(publicKey)
  }).reduce((previousValue, currentValue) => {
    return previousValue.add(currentValue);
  }).toBytesCompressed();
}

export default {
  generatePublicKey,
  sign,
  aggregateSignatures,
  aggregatePubkeys
}
