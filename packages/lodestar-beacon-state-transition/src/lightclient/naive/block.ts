import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient, phase0 as phase0Types} from "@chainsafe/lodestar-types";
import {phase0} from "../..";
import {processSyncCommittee} from ".";

export function processBlock(
  config: IBeaconConfig,
  state: lightclient.BeaconState & phase0Types.BeaconState,
  block: lightclient.BeaconBlock,
  verifySignatures = true
): void {
  // ugly hack, lightclient dropped two field from beacon state. Only way to make it typesafe is
  // to change all phase0 method to only require properties they use
  phase0.processBlock(config, state, block, verifySignatures);
  processSyncCommittee(config, state, block);
}
