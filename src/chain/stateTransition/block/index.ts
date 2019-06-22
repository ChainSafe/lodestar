/**
 * @module chain/stateTransition/block
 */

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";

import processEth1Data from "./eth1Data";
import processBlockHeader from "./blockHeader";
import processRandao from "./randao";
import processOperations from "./operations";


export function processBlock(state: BeaconState, block: BeaconBlock): void {
  // block header
  processBlockHeader(state, block);

  // RANDAO
  processRandao(state, block.body);

  // Eth1 Data
  processEth1Data(state, block.body);

  // Operations

  processOperations(state,block.body);

}
