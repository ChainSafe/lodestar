import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {initializeBeaconStateFromEth1} from "../chain/genesis/genesis";
import {interopDeposits} from "./deposits";

const INTEROP_BLOCK_HASH = Buffer.alloc(32, 'B');
const INTEROP_TIMESTAMP = Math.pow(2, 40);

export function quickStartState(
  config: IBeaconConfig,
  genesisTime: number,
  validatorCount: number,
): BeaconState {
  const deposits = interopDeposits(config, validatorCount);
  const state = initializeBeaconStateFromEth1(
    config,
    INTEROP_BLOCK_HASH,
    INTEROP_TIMESTAMP,
    deposits,
  );
  state.genesisTime = genesisTime;
  return state;
}
