import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";
import {G1point} from "./helpers/g1point";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";
import {ElipticCurvePairing} from "./helpers/ec-pairing";
import ctx from "./ctx";
import {BLSPubkey, BLSSecretKey, BLSSignature, bytes32, Domain} from "@chainsafe/eth2.0-types";

export {Keypair, PrivateKey, PublicKey, Signature};

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
  const hash = G2point.hashToG2(messageHash, domain);
  return privateKey.sign(hash).toBytesCompressed();
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
    return new G1point(new ctx.ECP()).toBytesCompressed();
  }
  return G1point.aggregate(publicKeys).toBytesCompressed();
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
    const key = PublicKey.fromBytes(publicKey);
    const sig = Signature.fromCompressedBytes(signature);

    key.getPoint().getPoint().affine();
    sig.getPoint().getPoint().affine();
    const g1Generated = G1point.generator();
    const e1 = ElipticCurvePairing.pair(key.getPoint(), G2point.hashToG2(messageHash, domain));
    const e2 = ElipticCurvePairing.pair(g1Generated, sig.getPoint());
    return e1.equals(e2);
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
export function verifyMultiple(publicKeys: BLSPubkey[], messageHashes: bytes32[], signature: BLSSignature, domain: Domain): boolean {
  if(publicKeys.length === 0 || publicKeys.length != messageHashes.length) {
    return false;
  }
  try {
    const sig = Signature.fromCompressedBytes(signature).getPoint();
    sig.getPoint().affine();

    const eCombined = new ctx.FP12(1);

    const reduction = messageHashes.reduce((previous, current, index) => {
      if(previous.hash && current.equals(previous.hash)) {
        return {
          hash: previous.hash,
          publicKey: previous.publicKey ?
            previous.publicKey.addRaw(publicKeys[index])
            :
            G1point.fromBytesCompressed(publicKeys[index]),
        };
      } else if(!!previous.hash) {
        const g2 = G2point.hashToG2(previous.hash, domain);
        eCombined.mul(
          ElipticCurvePairing.pair(
            previous.publicKey,
            g2
          )
        );
        return {hash: current, publicKey: G1point.fromBytesCompressed(publicKeys[index])};
      } else {
        return {
          hash: current,
          publicKey: G1point.fromBytesCompressed(publicKeys[index])
        };
      }
    }, {hash: null, publicKey: null});

    const g2Final = G2point.hashToG2(reduction.hash, domain);
    const keyFinal = reduction.publicKey;
    eCombined.mul(
      ElipticCurvePairing.pair(
        keyFinal,
        g2Final
      )
    );

    const e2 = ElipticCurvePairing.pair(G1point.generator(), sig);
    return e2.equals(eCombined);
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
