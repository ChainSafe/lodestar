/**
 * Assert that an array of deposits are consecutive and ascending
 * @param depositLogs
 */
export function assertConsecutiveDeposits(depositLogs: {index: number}[]): void {
  for (let i = 0; i < depositLogs.length - 1; i++) {
    const indexLeft = depositLogs[i].index;
    const indexRight = depositLogs[i + 1].index;
    if (indexLeft !== indexRight - 1) {
      throw Error(`Non consecutive deposits. deposit[${i}] = ${indexLeft}, deposit[${i + 1}] ${indexRight}`);
    }
  }
}
