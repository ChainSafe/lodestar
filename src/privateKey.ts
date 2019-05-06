import {BIG} from "../amcl/version3/js/ctx";
import {SECRET_KEY_LENGTH} from "./constants";
import assert from "assert";
import ctx from "./ctx";
import {padLeft} from "./helpers/utils";
import {G2point} from "./helpers/g2point";
import * as random from "secure-random";

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
    )
  }

  public static fromHexString(value: string): PrivateKey {
    return PrivateKey.fromBytes(
      Buffer.from(value.replace('0x', ''), 'hex')
    );
  }

  public static random(): PrivateKey {
    return new PrivateKey(
      ctx.BIG.frombytearray(
        random.randomBuffer(SECRET_KEY_LENGTH),
        0
      )
    )
  }

}
