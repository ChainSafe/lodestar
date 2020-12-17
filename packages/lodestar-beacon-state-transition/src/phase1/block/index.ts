import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1} from "@chainsafe/lodestar-types";
import {processBlockHeader, processRandao, processEth1Data} from "../../block";
import {processLightClientAggregate} from "./light_client";

export {processLightClientAggregate};
export * from "./operations";

export function processBlock(config: IBeaconConfig, state: Phase1.BeaconState, block: Phase1.BeaconBlock): void {
  processBlockHeader(config, state, block);
  processRandao(config, state, block.body, true);
  processEth1Data(config, state, block.body);
  processLightClientAggregate(config, state, block.body);
  //process_operations
}
