import {BLSDomain, BLSPrivKey, BLSPubkey, bytes32} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";

export default class BLS {

  public static generatePublicKey(privateKey: BLSPrivKey): BLSPubkey {
    const keypair = new Keypair(PrivateKey.fromBytes(privateKey));
    return keypair.publicKey.toBytesCompressed();
  }

  public static sign (secretKey: BLSPrivKey, messageHash: bytes32, domain: BLSDomain) {
    // const privateKey = PrivateKey.fromBytes(secretKey);
    // const hash = hashToG2(messageHash, domain)
    // return toBuffer(mcl.mul(hash, s))
  }
}
