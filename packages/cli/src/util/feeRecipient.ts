import {ExecutionAddress} from "@chainsafe/lodestar-types";
import {fromHex} from "@chainsafe/lodestar-utils";

export function parseFeeRecipientHex(feeRecipientHexString: string): string {
  const hexPattern = new RegExp(/^(0x|0X)(?<feeRecipientString>[a-fA-F0-9]{40})$/, "g");
  const feeRecipientStringMatch = hexPattern.exec(feeRecipientHexString);
  const feeRecipientString = feeRecipientStringMatch?.groups?.feeRecipientString;
  if (feeRecipientString === undefined)
    throw Error(`Invalid feeRecipient= ${feeRecipientHexString}, expected format: ^0x[a-fA-F0-9]{40}$`);
  return feeRecipientString;
}

export function parseFeeRecipient(feeRecipientHexString: string): ExecutionAddress {
  const feeRecipientHex = parseFeeRecipientHex(feeRecipientHexString);
  return fromHex(feeRecipientHex);
}
