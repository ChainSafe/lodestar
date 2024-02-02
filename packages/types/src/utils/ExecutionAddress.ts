import {keccak256} from "ethereum-cryptography/keccak.js";
import {ByteVectorType, fromHexString, toHexString} from "@chainsafe/ssz";

function isAddressValid(address: string): boolean {
  return /^(0x)?[0-9a-f]{40}$/i.test(address);
}

/**
 * Formats an address according to [ERC55](https://eips.ethereum.org/EIPS/eip-55)
 */
export function toChecksumAddress(address: string): string {
  if (!isAddressValid(address)) {
    throw new Error("Invalid address");
  }

  const rawAddress = address.toLowerCase().startsWith("0x") ? address.slice(2) : address;
  const bytes = fromHexString(rawAddress);
  const hash = toHexString(keccak256(bytes)).slice(2);
  let checksumAddress = "0x";
  for (let i = 0; i < rawAddress.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksumAddress += rawAddress[i].toUpperCase();
    } else {
      checksumAddress += rawAddress[i];
    }
  }
  return checksumAddress;
}

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
