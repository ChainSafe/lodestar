import assert from "assert";
import {FP_POINT_LENGTH} from "./constants";
import {BLSSignature, Domain, Hash} from "@chainsafe/eth2.0-types";
import {SignatureType} from "@chainsafe/eth2-bls-wasm";
import {getContext} from "./context";
import {PublicKey} from "./publicKey";
import {EMPTY_SIGNATURE, padLeft} from "./helpers/utils";

export class Signature {

  private value: SignatureType;

  protected constructor(value: SignatureType) {
    this.value = value;
  }

  public static fromCompressedBytes(value: BLSSignature): Signature {
    assert(
      value.length === 2 * FP_POINT_LENGTH,
      `Signature must have ${2 * FP_POINT_LENGTH} bytes`
    );
    const context = getContext();
    const signature = new context.Signature();
    if(!value.equals(EMPTY_SIGNATURE)) {
      signature.deserialize(value);
    }
    return new Signature(signature);
  }

  public static fromValue(signature: SignatureType): Signature {
    return new Signature(signature);
  }

  public add(other: Signature): Signature {
    const agg = this.value.clone();
    agg.add(other.value);
    return new Signature(
      agg
    );
  }

  public getValue(): SignatureType {
    return this.value;
  }

  public verify(publicKey: PublicKey, message: Hash, domain: Domain): boolean {
    domain = padLeft(domain, 8);
    return publicKey.verifyMessage(this, message, domain);
  }

  public verifyMultiple(publicKeys: PublicKey[], messages: Hash[], domain: Domain): boolean {
    domain = padLeft(domain, 8);
    return this.value.verifyAggregatedHashWithDomain(
      publicKeys.map((key) => key.getValue()),
      messages.map((message) => Buffer.concat([message, domain]))
    );
  }

  public toBytesCompressed(): BLSSignature {
    return Buffer.from(this.value.serialize());
  }

  public toHex(): string {
    return "0x" + this.value.serializeToHexStr();
  }
}
