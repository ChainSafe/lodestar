const HexBufferType = (value: string): Buffer => {
  return Buffer.from(value.replace("0x", ""), "hex");
};

export const typeMap: TypeMap = {
  MIN_DEPOSIT_AMOUNT: BigInt,
  MAX_EFFECTIVE_BALANCE: BigInt,
  EJECTION_BALANCE: BigInt,
  EFFECTIVE_BALANCE_INCREMENT: BigInt,
  INACTIVITY_PENALTY_QUOTIENT: BigInt,
  BLS_WITHDRAWAL_PREFIX: HexBufferType,
  DEPOSIT_CONTRACT_ADDRESS: HexBufferType,
  GENESIS_FORK_VERSION: HexBufferType,
};

export type TypeMap = {[k: string]: (value: any) => any};