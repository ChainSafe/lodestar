import {PrivateKey} from "./privateKey";
import {PublicKeyType} from "@chainsafe/eth2-bls-wasm";
import {getContext} from "./context";
import {PUBLIC_KEY_LENGTH} from "./constants";
import assert from "assert";
import {Signature} from "./signature";
import {EMPTY_PUBLIC_KEY} from "./helpers/utils";

export class PublicKey {

  private value: PublicKeyType;

  protected constructor(value: PublicKeyType) {
    this.value = value;
  }

  public static fromPrivateKey(privateKey: PrivateKey): PublicKey {
    return privateKey.toPublicKey();
  }

  public static fromBytes(bytes: Uint8Array): PublicKey {
    const context = getContext();
    const publicKey = new context.PublicKey();
    if(!EMPTY_PUBLIC_KEY.equals(bytes)) {
      publicKey.deserialize(bytes);
    }
    return new PublicKey(
      publicKey
    );
  }

  public static fromHex(value: string): PublicKey {
    value = value.replace("0x", "");
    assert(value.length === PUBLIC_KEY_LENGTH * 2);
    const context = getContext();
    return new PublicKey(
      context.deserializeHexStrToPublicKey(value)
    );
  }

  public static fromPublicKeyType(value: PublicKeyType): PublicKey {
    return new PublicKey(value);
  }

  public add(other: PublicKey): PublicKey {
    const agg = new PublicKey(this.value.clone());
    agg.value.add(other.value);
    return agg;
  }

  public verifyMessage(signature: Signature, messageHash: Uint8Array, domain: Uint8Array): boolean {
    return this.value.verifyHashWithDomain(signature.getValue(), Buffer.concat([messageHash, domain]));
  }

  public toBytesCompressed(): Buffer {
    return Buffer.from(this.value.serialize());
  }

  public toHexString(): string {
    return `0x${this.toBytesCompressed().toString("hex")}`;
  }

  public getValue(): PublicKeyType {
    return this.value;
  }
}
