import {TreeBackedValue, List} from "@chainsafe/ssz";
import {BeaconState, Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar/lib/chain/genesis/genesis";
import {interopDeposits} from "./deposits";

const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");
const INTEROP_TIMESTAMP = Math.pow(2, 40);

export function quickStartState(
  config: IBeaconConfig,
  depositDataRootList: TreeBackedValue<List<Root>>,
  genesisTime: number,
  validatorCount: number,
): BeaconState {
  const deposits = interopDeposits(config, depositDataRootList, validatorCount);
  const state = initializeBeaconStateFromEth1(
    config,
    INTEROP_BLOCK_HASH,
    INTEROP_TIMESTAMP,
    deposits,
  );
  state.genesisTime = genesisTime;
  return state;
}
