/**
 * Assert that an array of deposits are consecutive and ascending
 */
export function assertConsecutiveDeposits(depositEvents: {index: number}[]): void {
  for (let i = 0; i < depositEvents.length - 1; i++) {
    const indexLeft = depositEvents[i].index;
    const indexRight = depositEvents[i + 1].index;
    if (indexLeft !== indexRight - 1) {
      throw Error(`Non consecutive deposits. deposit[${i}] = ${indexLeft}, deposit[${i + 1}] ${indexRight}`);
    }
  }
}
