import {G1point} from "./helpers/g1point";
import {PrivateKey} from "./privateKey";
import {BLSPubkey} from "@chainsafe/eth2.0-types";

export class PublicKey {

  private point: G1point;

  public constructor(point: G1point) {
    this.point = point;
  }

  public getPoint(): G1point {
    return this.point;
  }

  public toBytesCompressed(): BLSPubkey {
    return  this.point.toBytesCompressed();
  }

  public toHexString(): string {
    return `0x${this.toBytesCompressed().toString('hex')}`;
  }

  public static fromPrivateKey(privateKey: PrivateKey): PublicKey {
    return new PublicKey(
      G1point.generator().mul(privateKey.getValue())
    );
  }

  public static fromBytes(publicKey: BLSPubkey): PublicKey {
    return new PublicKey(
      G1point.fromBytesCompressed(publicKey)
    );
  }
}
