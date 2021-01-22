import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Lightclient} from "@chainsafe/lodestar-types";
import * as phase0Block from "../block";
import {processSyncCommittee} from ".";

export function processBlock(
  config: IBeaconConfig,
  state: Lightclient.BeaconState,
  block: Lightclient.BeaconBlock,
  verifySignatures = true
): void {
  phase0Block.processBlock(config, state, block, verifySignatures);
  processSyncCommittee(config, state, block);
}
