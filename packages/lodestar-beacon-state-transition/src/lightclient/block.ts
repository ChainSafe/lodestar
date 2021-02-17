import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Lightclient} from "@chainsafe/lodestar-types";
import {phase0} from "../";
import {processSyncCommittee} from ".";

export function processBlock(
  config: IBeaconConfig,
  state: Lightclient.BeaconState,
  block: Lightclient.BeaconBlock,
  verifySignatures = true
): void {
  phase0.processBlock(config, state, block, verifySignatures);
  processSyncCommittee(config, state, block);
}
