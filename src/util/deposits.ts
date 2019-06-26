import {Deposit} from "../types";
import {MAX_DEPOSITS} from "../constants";

export function processSortedDeposits(
  deposits: Deposit[],
  from: number,
  to: number,
  process: (d: Deposit) => Deposit): Deposit[] {
  return deposits
    //remove possible old deposits
    .filter((deposit) => deposit.index >= from)
    //ensure deposit order
    .sort((a, b) => a.index - b.index)
    .slice(0, Math.min(MAX_DEPOSITS, to - from))
    .map((deposit) => {
      return process(deposit);
    })
}
