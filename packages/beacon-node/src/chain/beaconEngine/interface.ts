import {BeaconConfig} from "@lodestar/config";
import {PubkeyCache} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {IClock} from "../../util/clock.js";
import {ChainEventEmitter} from "../emitter.js";
import {SeenBlockInput} from "../seenCache/seenGossipBlockInput.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {IBeaconEngineOptions} from "./options.js";

export type BeaconEngineModules = {
  opts: IBeaconEngineOptions;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  clock: IClock;
  pubkeyCache: PubkeyCache;
  bufferPool: BufferPool;
  cpStateDatastore: CPStateDatastore;
  // TODO - beacon engine: emitter is facade infra; forkChoice/regen should not depend on it inside the engine.
  emitter: ChainEventEmitter;
  signal: AbortSignal;
  db: IBeaconDb;
  validatorMonitor: ValidatorMonitor | null;
  seenBlockInputCache: SeenBlockInput;
  isAnchorStateFinalized: boolean;
};

/**
 * The consensus engine seam. Starts minimal and transitional (JS-only); ownership of consensus
 * collaborators and flows migrates here across later phases. This interface is the contract shared
 * with the native engine (lodestar-z) — both the JS and native engines implement the same signatures.
 */
export interface IBeaconEngine {
  readonly config: BeaconConfig;
}
