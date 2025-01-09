/**
 * From https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1559.md
 */
const gasLimitAdjustmentFactor = 1024;

/**
 * Calculates expected gas limit based on parent gas limit and target gas limit
 */
export function getExpectedGasLimit(parentGasLimit: number, targetGasLimit: number): number {
  const maxGasLimitDifference = Math.max(Math.floor(parentGasLimit / gasLimitAdjustmentFactor) - 1, 0);

  if (targetGasLimit > parentGasLimit) {
    const gasDiff = targetGasLimit - parentGasLimit;
    return parentGasLimit + Math.min(gasDiff, maxGasLimitDifference);
  }

  const gasDiff = parentGasLimit - targetGasLimit;
  return parentGasLimit - Math.min(gasDiff, maxGasLimitDifference);
}
