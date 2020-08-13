import path from "path";

export const VOTING_KEYSTORE_FILE = "voting-keystore.json";
export const WITHDRAWAL_KEYSTORE_FILE = "withdrawal-keystore.json";
export const ETH1_DEPOSIT_DATA_FILE = "eth1-deposit-data.rlp";
export const ETH1_DEPOSIT_AMOUNT_FILE = "eth1-deposit-gwei.txt";
export const ETH1_DEPOSIT_TX_HASH_FILE = "eth1-deposit-tx-hash.txt";
/**
 * The file used for indicating if a directory is in-use by another process.
 */
export const LOCK_FILE = ".lock";

// Dynamic paths computed from the validator pubkey

export function getValidatorDirPath(
  {keystoresDir, pubkey}: {keystoresDir: string; pubkey: string}
): string {
  return path.join(keystoresDir, pubkey);
}

export function getValidatorPassphrasePath(
  {secretsDir, pubkey}: {secretsDir: string; pubkey: string}
): string {
  return path.join(secretsDir, pubkey);
}