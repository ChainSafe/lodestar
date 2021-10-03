import {List, TreeBacked} from "@chainsafe/ssz";
import {allForks, Bytes32, Number64, phase0, Root} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

export const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");
export const INTEROP_TIMESTAMP = Math.pow(2, 40);

export type InteropStateOpts = {
  genesisTime?: number;
  eth1BlockHash?: Bytes32;
  eth1Timestamp?: Number64;
};

export function getInteropState(
  config: IChainForkConfig,
  {
    genesisTime = Math.floor(Date.now() / 1000),
    eth1BlockHash = INTEROP_BLOCK_HASH,
    eth1Timestamp = INTEROP_TIMESTAMP,
  }: InteropStateOpts,
  deposits: phase0.Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>
): TreeBacked<allForks.BeaconState> {
  const state = initializeBeaconStateFromEth1(config, eth1BlockHash, eth1Timestamp, deposits, fullDepositDataRootList);
  state.genesisTime = genesisTime;
  return state;
}
