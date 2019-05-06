import {BLSDomain, BLSPrivKey, BLSPubkey, BLSSignature, bytes32} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";
import {PublicKey} from "./publicKey";
import {G1point} from "./helpers/g1point";

export default class BLS {

  public static generatePublicKey(privateKey: BLSPrivKey): BLSPubkey {
    const keypair = new Keypair(PrivateKey.fromBytes(privateKey));
    return keypair.publicKey.toBytesCompressed();
  }

  public static sign(secretKey: BLSPrivKey, messageHash: bytes32, domain: BLSDomain): BLSSignature {
    const privateKey = PrivateKey.fromBytes(secretKey);
    const hash = G2point.hashToG2(messageHash, domain);
    return privateKey.sign(hash).toBytesCompressed();
  }

  public static aggregateSignatures(signatures: BLSSignature[]): BLSSignature {
    return signatures.map((signature) => {
      return G2point.fromCompressedBytes(signature)
    }).reduce((previousValue, currentValue) => {
      return previousValue.add(currentValue);
    }).toBytesCompressed();
  }

  public static aggregatePubkeys(publicKeys: BLSPubkey[]): BLSPubkey {
    return publicKeys.map((publicKey) => {
      return G1point.fromBytesCompressed(publicKey)
    }).reduce((previousValue, currentValue) => {
      return previousValue.add(currentValue);
    }).toBytesCompressed();
  }
}
