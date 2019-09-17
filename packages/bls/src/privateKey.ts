import {BIG} from "@chainsafe/milagro-crypto-js/src/big";
import {FP_POINT_LENGTH, SECRET_KEY_LENGTH} from "./constants";
import assert from "assert";
import ctx from "./ctx";
import {padLeft} from "./helpers/utils";
import {G2point} from "./helpers/g2point";
import * as random from "secure-random";
import {BLSSecretKey, Hash, Domain} from "@chainsafe/eth2.0-types";

export class PrivateKey {

  private value: BIG;

  public constructor(value: BIG) {
    this.value = value;
  }

  public getValue(): BIG {
    return this.value;
  }

  public sign(message: G2point): G2point {
    return message.mul(this.value);
  }

  public signMessage(message: Hash, domain: Domain): G2point {
    return G2point.hashToG2(message, domain).mul(this.value);
  }

  public toBytes(): BLSSecretKey {
    const buffer = Buffer.alloc(FP_POINT_LENGTH, 0);
    this.value.tobytearray(buffer, 0);
    return buffer.slice(FP_POINT_LENGTH - SECRET_KEY_LENGTH);
  }

  public toHexString(): string {
    return `0x${this.toBytes().toString('hex')}`;
  }

  public static fromBytes(bytes: Uint8Array): PrivateKey {
    assert(bytes.length === SECRET_KEY_LENGTH, 'Private key should have 32 bytes');
    const value = Buffer.from(bytes);
    return new PrivateKey(
      ctx.BIG.frombytearray(
        padLeft(
          value,
          48
        ),
        0
      )
    );
  }

  public static fromHexString(value: string): PrivateKey {
    return PrivateKey.fromBytes(
      Buffer.from(value.replace('0x', ''), 'hex')
    );
  }

  public static random(): PrivateKey {
    return PrivateKey.fromBytes(random.randomBuffer(SECRET_KEY_LENGTH));
  }

}
