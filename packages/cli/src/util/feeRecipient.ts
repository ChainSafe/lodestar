export function parseFeeRecipient(feeRecipientHex: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/i.test(feeRecipientHex)) {
    throw Error(`Invalid feeRecipient= ${feeRecipientHex}, expected format: ^0x[a-fA-F0-9]{40}$`);
  }
  return feeRecipientHex.toLowerCase();
}
