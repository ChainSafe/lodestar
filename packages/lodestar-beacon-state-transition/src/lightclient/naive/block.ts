import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";
import {phase0} from "../..";
import {processSyncCommittee} from ".";

export function processBlock(
  config: IBeaconConfig,
  state: lightclient.BeaconState,
  block: lightclient.BeaconBlock,
  verifySignatures = true
): void {
  phase0.processBlock(config, state, block, verifySignatures);
  processSyncCommittee(config, state, block);
}
