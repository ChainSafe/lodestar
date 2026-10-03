import {GasLimitSchedule} from "../chainConfig/types.js";

export function validateGasLimitSchedule(gasLimitSchedule: GasLimitSchedule): void {
  let previousEpoch: number | undefined;

  for (const [i, entry] of gasLimitSchedule.entries()) {
    if (previousEpoch !== undefined) {
      if (entry.EPOCH < previousEpoch) {
        throw Error(
          `Invalid GAS_LIMIT_SCHEDULE expected entries to be sorted by EPOCH in ascending order, ${entry.EPOCH} < ${previousEpoch} at index ${i}`
        );
      }
      if (entry.EPOCH === previousEpoch) {
        throw Error(
          `Invalid GAS_LIMIT_SCHEDULE[${i}] entry with the same epoch value ${entry.EPOCH} as previous GAS_LIMIT_SCHEDULE[${i - 1}] entry`
        );
      }
    }

    previousEpoch = entry.EPOCH;
  }
}
