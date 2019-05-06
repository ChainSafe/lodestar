import {
  BLSDomain,
  BLSSecretKey,
  BLSPubkey,
  BLSSignature,
  bytes32,
  bytes8
} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";
import {G1point} from "./helpers/g1point";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";
import {ElipticCurvePairing} from "./helpers/ec-pairing";

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
  return signatures.map((signature): Signature => {
    return Signature.fromCompressedBytes(signature)
  }).reduce((previousValue, currentValue): Signature => {
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

function verify(publicKey: BLSPubkey, messageHash: bytes32, signature: BLSSignature, domain: bytes8): boolean {
  const key = PublicKey.fromBytes(publicKey);
  const sig = Signature.fromCompressedBytes(signature);

  const g1Generator = G1point.generator();
  const e1 = ElipticCurvePairing.pair(key.getPoint(), G2point.hashToG2(messageHash, domain));
  const e2 = ElipticCurvePairing.pair(g1Generator, sig.getPoint());
  return e1.equals(e2);
}

export default {
  generateKeyPair,
  generatePublicKey,
  sign,
  aggregateSignatures,
  aggregatePubkeys,
  verify
}
