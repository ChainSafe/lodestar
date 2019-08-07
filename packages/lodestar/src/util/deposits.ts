import {Deposit} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export function processSortedDeposits(
  config: IBeaconConfig,
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
