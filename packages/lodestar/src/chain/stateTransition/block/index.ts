/**
 * @module chain/stateTransition/block
 */

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";
import {IBeaconConfig} from "../../../config";

import {processEth1Data} from "./eth1Data";
import {processBlockHeader} from "./blockHeader";
import {processRandao} from "./randao";
import {processOperations} from "./operations";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#block-processing

export function processBlock(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verify: boolean = true
): void {
  // block header
  processBlockHeader(config, state, block, verify);

  // RANDAO
  processRandao(config, state, block.body);

  // Eth1 Data
  processEth1Data(config, state, block.body);

  // Operations
  processOperations(config, state,block.body);
}
