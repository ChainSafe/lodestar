export const ETH_TO_GWEI = BigInt(10 ** 9);
export const GWEI_TO_WEI = BigInt(10 ** 9);
export const ETH_TO_WEI = ETH_TO_GWEI * GWEI_TO_WEI;

type EthNumeric = bigint;

/**
 * Convert gwei to wei.
 */
export function gweiToWei(gwei: EthNumeric): EthNumeric {
  return gwei * GWEI_TO_WEI;
}
