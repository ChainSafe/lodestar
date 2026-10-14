import path from "node:path";
import {PrivateKey} from "@libp2p/interface";
import {readBeaconStateBytesMetadata} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {BeaconEngine, BeaconEngineCore, IBeaconEngine} from "../../src/chain/beaconEngine/index.js";
import {BlockSerializedCache} from "../../src/chain/blocks/blockSerializedCache.js";
import {BeaconChainModules} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {IChainOptions} from "../../src/chain/options.js";
import {DbCPStateDatastore} from "../../src/chain/stateCache/datastore/db.js";
import {FileCPStateDatastore} from "../../src/chain/stateCache/datastore/file.js";
import {ValidatorMonitorOpts} from "../../src/chain/validatorMonitor.js";
import {BuilderApiClientOpts} from "../../src/execution/builder/apiClient.js";
import {computeNodeIdFromPrivateKey} from "../../src/network/subnets/interface.js";
import {Clock, IClock} from "../../src/util/clock.js";
import {CustodyConfig} from "../../src/util/dataColumns.js";
import {SerializedCache} from "../../src/util/serializedCache.js";

export type TestBeaconEngineModules = Omit<
  BeaconChainModules,
  | "beaconEngine"
  | "anchor"
  | "earliestAvailableSlot"
  | "abortController"
  | "clock"
  | "emitter"
  | "cpStateDatastore"
  | "custodyConfig"
  | "builderApiClient"
  | "serializedCache"
  | "blockSerializedCache"
> & {
  earliestAvailableSlot?: Slot;
  validatorMonitorOpts?: ValidatorMonitorOpts | null;
  privateKey: PrivateKey;
  clock?: IClock;
  anchorStateBytes: Uint8Array;
  isAnchorStateFinalized: boolean;
  builderApiClientOpts?: BuilderApiClientOpts;
};

export function createTestBeaconEngine(
  opts: IChainOptions,
  modules: TestBeaconEngineModules
): Omit<BeaconChainModules, "anchor" | "builderApiClient" | "beaconEngine" | "earliestAvailableSlot"> & {
  beaconEngine: BeaconEngine;
  beaconEngineCore: BeaconEngineCore;
} {
  const {
    privateKey,
    config,
    pubkeyCache,
    db,
    dbName,
    dataDir,
    dataColumnDir,
    logger,
    metrics,
    isAnchorStateFinalized,
    executionEngine,
    executionBuilder,
    builderApiClientOpts,
    anchorStateBytes,
  } = modules;
  const metadata = readBeaconStateBytesMetadata(anchorStateBytes);
  if (!metadata) throw new LodestarError({code: "ANCHOR_STATE_BYTES_INVALID"});
  const abortController = new AbortController();
  const signal = abortController.signal;
  const emitter = new ChainEventEmitter();
  const clock = modules.clock ?? new Clock({config, genesisTime: metadata.genesisTime, signal});
  const fileDataStore = opts.nHistoricalStatesFileDataStore ?? true;
  // checkpointState is an engine repo; build the datastore from the bootstrap `db` (union) param.
  const cpStateDatastore = fileDataStore ? new FileCPStateDatastore(dataDir) : new DbCPStateDatastore(db);

  const nodeId = computeNodeIdFromPrivateKey(privateKey);
  const initialCustodyGroupCount = opts.initialCustodyGroupCount ?? config.CUSTODY_REQUIREMENT;
  metrics?.peerDas.custodyGroupCount.set(initialCustodyGroupCount);
  // TODO: backfill not implemented yet
  metrics?.peerDas.custodyGroupsBackfilled.set(0);
  const custodyConfig = new CustodyConfig({
    nodeId,
    config,
    initialCustodyGroupCount,
  });

  const serializedCache = new SerializedCache({cacheDeserialized: !opts.beaconEngineWorker});
  const blockSerializedCache = new BlockSerializedCache(config);
  const beaconEngineCore = new BeaconEngineCore({
    serializedCache: opts.beaconEngineWorker ? undefined : serializedCache,
    blockSerializedCache: opts.beaconEngineWorker ? undefined : blockSerializedCache,
    executionEngine,
    executionBuilder,
    builderApiClientOpts,
    opts,
    config,
    logger,
    dbName,
    dataColumnDir: dataColumnDir ?? path.join(dataDir, "data_columns"),
    metrics,
    clock,
    pubkeyCache,
    cpStateDatastore,
    emitter,
    signal,
    db,
    validatorMonitorOpts: modules.validatorMonitorOpts ?? null,
    isAnchorStateFinalized,
  });
  const beaconEngine = new BeaconEngine({core: beaconEngineCore, emitter});
  return {
    ...modules,
    serializedCache,
    blockSerializedCache,
    beaconEngine,
    beaconEngineCore,
    abortController,
    clock,
    emitter,
    cpStateDatastore,
    custodyConfig,
  };
}

/** Access the in-process core for tests that inspect or mutate consensus internals. */
export function getBeaconEngineCore(engine: IBeaconEngine): BeaconEngineCore {
  const core: unknown = Reflect.get(engine, "core");
  if (!(core instanceof BeaconEngineCore)) throw Error("Expected an in-process BeaconEngineCore");
  return core;
}
