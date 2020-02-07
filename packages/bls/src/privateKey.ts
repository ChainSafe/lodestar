import {SECRET_KEY_LENGTH} from "./constants";
import assert from "assert";
import {BLSSecretKey, bytes32} from "@chainsafe/eth2.0-types";
import {SecretKeyType} from "@chainsafe/eth2-bls-wasm";
import {generateRandomSecretKey} from "@chainsafe/bls-keygen";
import {getContext} from "./context";
import {PublicKey} from "./publicKey";
import {Signature} from "./signature";

export class PrivateKey {

  private value: SecretKeyType;

  protected constructor(value: SecretKeyType) {
    this.value = value;
  }

  public static fromBytes(bytes: Uint8Array): PrivateKey {
    assert(bytes.length === SECRET_KEY_LENGTH, "Private key should have 32 bytes");
    const context = getContext();
    const secretKey = new context.SecretKey();
    secretKey.deserialize(Buffer.from(bytes));
    return new PrivateKey(secretKey);
  }

  public static fromHexString(value: string): PrivateKey {
    value = value.replace("0x", "");
    assert(value.length === SECRET_KEY_LENGTH * 2, "secret key must have 32 bytes");
    const context = getContext();
    return new PrivateKey(context.deserializeHexStrToSecretKey(value));
  }

  public static fromInt(num: number): PrivateKey {
    const context = getContext();
    const secretKey = new context.SecretKey();
    secretKey.setInt(num);
    return new PrivateKey(secretKey);
  }

  public static random(): PrivateKey {
    const randomKey: Buffer = generateRandomSecretKey();
    return this.fromBytes(randomKey);
  }

  public getValue(): SecretKeyType {
    return this.value;
  }

  // public sign(message: Uint8Array): Signature {
  //   return Signature.fromValue(this.value.sign(message));
  // }

  public signMessage(message: bytes32): Signature {
    return Signature.fromValue(this.value.sign(Buffer.concat([message])));
  }

  public toPublicKey(): PublicKey {
    return PublicKey.fromPublicKeyType(this.value.getPublicKey());
  }

  public toBytes(): BLSSecretKey {
    return Buffer.from(this.value.serialize());
  }

  public toHexString(): string {
    return `0x${this.value.serializeToHexStr()}`;
  }
}
