import {BLSDomain, BLSPrivKey, BLSPubkey, BLSSignature, bytes32} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";
import {G2point} from "./helpers/g2point";

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
}
