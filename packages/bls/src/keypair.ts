import {PublicKey} from "./publicKey";
import {PrivateKey} from "./privateKey";


export class Keypair {

  private _publicKey: PublicKey;

  private _privateKey: PrivateKey;

  public constructor(privateKey: PrivateKey, publicKey?: PublicKey) {
    this._privateKey = privateKey;
    if(!publicKey) {
      this._publicKey = PublicKey.fromPrivateKey(this._privateKey);
    } else {
      this._publicKey = publicKey;
    }
  }

  public get publicKey(): PublicKey {
    return this._publicKey;
  }

  public get privateKey(): PrivateKey {
    return this._privateKey;
  }

  public static generate(): Keypair {
    return new Keypair(PrivateKey.random());
  }
}
