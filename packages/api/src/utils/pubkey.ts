import {ByteVectorType} from "@chainsafe/ssz";
import {fromHex, toHex} from "@lodestar/utils";

const PUBKEY_SIZE = 48;
const XMSS_PUBKEY_SIZE = 32;
const XMSS_PREFIX_SIZE = PUBKEY_SIZE - XMSS_PUBKEY_SIZE;

/**
 * A validator's public key in a response. It is held as 48 bytes: a BLS public key, or 16 zero
 * bytes then a leanXMSS public key, which no compressed BLS public key starts with. In JSON a
 * leanXMSS public key is its own 32 bytes.
 */
class ApiPubkeyType extends ByteVectorType {
  constructor() {
    super(PUBKEY_SIZE);
  }

  toJson(value: Uint8Array): unknown {
    for (let i = 0; i < XMSS_PREFIX_SIZE; i++) {
      if (value[i] !== 0) return super.toJson(value);
    }
    return toHex(value.subarray(XMSS_PREFIX_SIZE));
  }

  fromJson(json: unknown): Uint8Array {
    if (typeof json !== "string" || json.length !== 2 + 2 * XMSS_PUBKEY_SIZE) return super.fromJson(json);
    const value = new Uint8Array(PUBKEY_SIZE);
    value.set(fromHex(json), XMSS_PREFIX_SIZE);
    return value;
  }
}

export const ApiPubkey: ByteVectorType = new ApiPubkeyType();
