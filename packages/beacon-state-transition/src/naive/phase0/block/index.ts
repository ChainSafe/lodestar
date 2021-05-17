/**
 * @module chain/stateTransition/block
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {processEth1Data} from "./eth1Data";
import {processBlockHeader} from "./blockHeader";
import {processRandao} from "./randao";
import {processOperations} from "./operations";

export * from "./eth1Data";
export * from "./blockHeader";
export * from "./randao";
export * from "./operations";

export function processBlock(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  block: phase0.BeaconBlock,
  verifySignatures = true
): void {
  // block header
  processBlockHeader(config, state, block);

  // RANDAO
  processRandao(config, state, block.body, verifySignatures);

  // Eth1 Data
  processEth1Data(config, state, block.body);

  // Operations
  processOperations(config, state, block.body, verifySignatures);
}
