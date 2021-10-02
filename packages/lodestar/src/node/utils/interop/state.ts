import {List, TreeBacked} from "@chainsafe/ssz";
import {allForks, phase0, Root} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

export const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");
export const INTEROP_TIMESTAMP = Math.pow(2, 40);

export function getInteropState(
  config: IChainForkConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  genesisTime: number,
  deposits: phase0.Deposit[]
): TreeBacked<allForks.BeaconState> {
  const state = initializeBeaconStateFromEth1(config, INTEROP_BLOCK_HASH, INTEROP_TIMESTAMP, deposits);
  state.genesisTime = genesisTime;
  return state;
}
