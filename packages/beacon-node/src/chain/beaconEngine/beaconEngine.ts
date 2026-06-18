import {BeaconConfig} from "@lodestar/config";
import {IBeaconStateView} from "@lodestar/state-transition";
import {BeaconEngineModules, IBeaconEngine} from "./interface.js";

/**
 * JS implementation of the consensus engine. Transitional in Phase 0: constructed inside
 * `BeaconChain` from the `anchorState` object; construction moves to the CLI in Phase 6.
 *
 * Minimal by design — collaborators, state ownership and flows migrate here in later phases.
 */
export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;

  constructor(modules: BeaconEngineModules, _anchorState: IBeaconStateView) {
    this.config = modules.config;
  }
}
