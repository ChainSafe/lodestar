import {List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function generateInitialMaxBalances(config: IBeaconConfig, count?: number): List<bigint> {
  return Array.from(
    {length: count ?? config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
    () => config.params.MAX_EFFECTIVE_BALANCE
  ) as List<bigint>;
}
