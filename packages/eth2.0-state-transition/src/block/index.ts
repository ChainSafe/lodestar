/**
 * @module chain/stateTransition/block
 */

import {BeaconBlock, BeaconState,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {processEth1Data} from "./eth1Data";
import {processBlockHeader} from "./blockHeader";
import {processRandao} from "./randao";
import {processOperations} from "./operations";

export * from "./eth1Data";
export * from "./blockHeader";
export * from "./randao";
export * from "./operations";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#block-processing

export function processBlock(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  verify: boolean = true,
  trusted: boolean = false
): void {
  // block header
  processBlockHeader(config, state, block, verify);

  // RANDAO
  processRandao(config, state, block.body, trusted);

  // Eth1 Data
  processEth1Data(config, state, block.body);

  // Operations
  processOperations(config, state, block.body, trusted);
}
