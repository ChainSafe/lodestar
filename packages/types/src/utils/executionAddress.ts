import {keccak256} from "ethereum-cryptography/keccak.js";
import {ByteVectorType} from "@chainsafe/ssz";

export type ByteVector = Uint8Array;

export class ExecutionAddressType extends ByteVectorType {
  constructor() {
    super(20, {typeName: "ExecutionAddress"});
  }
  toJson(value: ByteVector): unknown {
    const str = super.toJson(value) as string;
    return toChecksumAddress(str);
  }
}

function isAddressValid(address: string): boolean {
  return /^(0x)?[0-9a-f]{40}$/i.test(address);
}

/**
 * Formats an address according to [ERC55](https://eips.ethereum.org/EIPS/eip-55)
 */
export function toChecksumAddress(address: string): string {
  if (!isAddressValid(address)) {
    throw Error(`Invalid address: ${address}`);
  }

  const rawAddress = (address.startsWith("0x") ? address.slice(2) : address).toLowerCase();
  const chars = rawAddress.split("");

  // Inspired by https://github.com/ethers-io/ethers.js/blob/cac1da1f912c2ae9ba20f25aa51a91766673cd76/src.ts/address/address.ts#L8
  const expanded = new Uint8Array(chars.length);
  for (let i = 0; i < expanded.length; i++) {
    expanded[i] = rawAddress[i].charCodeAt(0);
  }

  const hashed = keccak256(expanded);
  for (let i = 0; i < chars.length; i += 2) {
    if (hashed[i >> 1] >> 4 >= 8) {
      chars[i] = chars[i].toUpperCase();
    }
    if ((hashed[i >> 1] & 0x0f) >= 8) {
      chars[i + 1] = chars[i + 1].toUpperCase();
    }
  }

  return "0x" + chars.join("");
}
