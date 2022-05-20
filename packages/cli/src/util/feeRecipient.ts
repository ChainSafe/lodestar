import {ExecutionAddress} from "@chainsafe/lodestar-types";
import {fromHex} from "@chainsafe/lodestar-utils";

export function parseFeeRecipient(feeRecipientHex: string): ExecutionAddress {
  if (!/^0x[a-fA-F0-9]{40}$/i.test(feeRecipientHex)) {
    throw Error(`Invalid feeRecipient= ${feeRecipientHex}, expected format: ^0x[a-fA-F0-9]{40}$`);
  }
  return fromHex(feeRecipientHex.toLowerCase());
}
