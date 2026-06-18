import {BeaconConfig} from "@lodestar/config";
import {PubkeyCache} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {IBeaconEngineOptions} from "./options.js";

export type BeaconEngineModules = {
  opts: IBeaconEngineOptions;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  clock: IClock;
  pubkeyCache: PubkeyCache;
};

/**
 * The consensus engine seam. Starts minimal and transitional (JS-only); ownership of consensus
 * collaborators and flows migrates here across later phases. This interface is the contract shared
 * with the native engine (lodestar-z) — both the JS and native engines implement the same signatures.
 */
export interface IBeaconEngine {
  readonly config: BeaconConfig;
}
