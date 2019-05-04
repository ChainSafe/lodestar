import {BIG} from "../amcl/version3/js/ctx";
import {PRIVATE_KEY_LENGTH} from "./constants";
import assert from "assert";
import ctx from "./ctx";
import {padLeft} from "./helpers/utils";

export class PrivateKey {

  private value: BIG;

  public constructor(value: BIG) {
    this.value = value;
  }

  public getValue(): BIG {
    return this.value;
  }

  public static fromBytes(bytes: Uint8Array): PrivateKey {
    assert(bytes.length === PRIVATE_KEY_LENGTH, 'Private key should have 32 bytes');
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

}
