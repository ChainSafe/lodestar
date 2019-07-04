import {Deposit} from "../types";
import {BeaconConfig} from "../config";

export function processSortedDeposits(
  config: BeaconConfig,
  deposits: Deposit[],
  from: number,
  to: number,
  process: (d: Deposit, index: number) => Deposit): Deposit[] {
  return deposits
    //assume deposit order
    .slice(0, Math.min(config.params.MAX_DEPOSITS, to - from))
    .map((deposit, index) => {
      return process(deposit, index + from);
    });
}
