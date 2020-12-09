import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClient} from "@chainsafe/lodestar-types";
import * as phase0Block from "../block";

export function processBlock(
  config: IBeaconConfig,
  state: LightClient.BeaconState,
  block: LightClient.BeaconBlock
): void {
  phase0Block.processBlock(config, state, block);
  processSyncCommittee(config, state, block);
}
