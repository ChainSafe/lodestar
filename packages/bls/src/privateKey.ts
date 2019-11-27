import {SECRET_KEY_LENGTH} from "./constants";
import assert from "assert";
import {BLSSecretKey, Domain, Hash} from "@chainsafe/eth2.0-types";
import {SecretKeyType, SignatureType} from "@chainsafe/eth2-bls-wasm";
import {getContext} from "./context";

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

  public static random(): PrivateKey {
    const context = getContext();
    const secretKey = new context.SecretKey();
    secretKey.setByCSPRNG();
    return new PrivateKey(secretKey);
  }

  public getValue(): SecretKeyType {
    return this.value;
  }

  public sign(message: Uint8Array): SignatureType {
    return this.value.sign(message);
  }

  public signMessage(message: Hash, domain: Domain): SignatureType {
    return this.value.signHashWithDomain(Buffer.concat([message, domain]));
  }

  public toBytes(): BLSSecretKey {
    return Buffer.from(this.value.serialize());
  }

  public toHexString(): string {
    return `0x${this.value.serializeToHexStr()}`;
  }
}
