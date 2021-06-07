import {List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

export function generateInitialMaxBalances(config: IBeaconConfig, count?: number): List<bigint> {
  return Array.from({length: count ?? config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT}, () => MAX_EFFECTIVE_BALANCE) as List<
    bigint
  >;
}
