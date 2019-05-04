import {BLSPrivKey, BLSPubkey} from "./types";
import {Keypair} from "./keypair";
import {PrivateKey} from "./privateKey";

export default class BLS {

  public static generatePublicKey(privateKey: BLSPrivKey): BLSPubkey {
    const keypair = new Keypair(PrivateKey.fromBytes(privateKey));
    return keypair.publicKey.toBytesCompressed();
  }
}
