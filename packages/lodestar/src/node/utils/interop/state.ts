import {List, TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Deposit, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {initializeBeaconStateFromEth1} from "../../../chain/genesis/genesis";

const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");
const INTEROP_TIMESTAMP = Math.pow(2, 40);

export function getInteropState(
  config: IBeaconConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  genesisTime: number,
  deposits: Deposit[],
): BeaconState {
  const state = initializeBeaconStateFromEth1(
    config,
    INTEROP_BLOCK_HASH,
    INTEROP_TIMESTAMP,
    deposits,
  );
  state.genesisTime = genesisTime;
  return state;
}
