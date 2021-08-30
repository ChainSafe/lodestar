import {List} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

export function generateInitialMaxBalances(config: IChainForkConfig, count?: number): List<bigint> {
  return Array.from(
    {length: count ?? config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
    () => MAX_EFFECTIVE_BALANCE
  ) as List<bigint>;
}
