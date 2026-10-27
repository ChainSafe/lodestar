import path from "node:path";
import {PrivateKey} from "@libp2p/interface";
import {chainConfigToJson} from "@lodestar/config";
import {readBeaconStateBytesMetadata} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {BeaconEngineCore} from "../../src/chain/beaconEngine/index.js";
import {BeaconEngineMode, assertSupportedBeaconEngineMode} from "../../src/chain/beaconEngine/options.js";
import {BeaconEngine, type IBeaconEngine} from "../../src/chain/beaconEngine.js";
import {BeaconChainModules} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {IChainOptions} from "../../src/chain/options.js";
import {ValidatorMonitorOpts} from "../../src/chain/validatorMonitor.js";
import {ExecutionBuilderOpts} from "../../src/execution/builder/index.js";
import {computeNodeIdFromPrivateKey} from "../../src/network/subnets/interface.js";
import {Clock, IClock} from "../../src/util/clock.js";
import {CustodyConfig} from "../../src/util/dataColumns.js";
import {SerializedCache} from "../../src/util/serializedCache.js";

export type TestBeaconEngineModules = Omit<
  BeaconChainModules,
  | "beaconEngine"
  | "anchor"
  | "earliestAvailableSlot"
  | "clock"
  | "emitter"
  | "custodyConfig"
  | "builderApiClient"
  | "serializedCache"
> & {
  executionBuilderOpts?: ExecutionBuilderOpts;
  earliestAvailableSlot?: Slot;
  validatorMonitorOpts?: ValidatorMonitorOpts | null;
  privateKey: PrivateKey;
  clock?: IClock;
  anchorStateBytes: Uint8Array;
  isAnchorStateFinalized: boolean;
};

export function createTestBeaconEngine(
  opts: IChainOptions,
  modules: TestBeaconEngineModules
): Omit<BeaconChainModules, "anchor" | "builderApiClient" | "beaconEngine" | "earliestAvailableSlot"> & {
  beaconEngine: BeaconEngine;
  beaconEngineCore: BeaconEngineCore;
  abortController: AbortController;
} {
  const beaconEngineMode = opts.beaconEngineMode ?? BeaconEngineMode.MainThread;
  assertSupportedBeaconEngineMode(beaconEngineMode);

  const {executionBuilderOpts, ...chainModules} = modules;
  const {
    privateKey,
    config,
    db,
    dbName,
    dataDir,
    dataColumnDir,
    logger,
    metrics,
    isAnchorStateFinalized,
    executionEngine,
    builderApiClientOpts,
    anchorStateBytes,
  } = modules;
  const metadata = readBeaconStateBytesMetadata(anchorStateBytes);
  if (!metadata) throw new LodestarError({code: "ANCHOR_STATE_BYTES_INVALID"});
  const abortController = new AbortController();
  const signal = abortController.signal;
  const emitter = new ChainEventEmitter();
  const clock = modules.clock ?? new Clock({config, genesisTime: metadata.genesisTime, signal});

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

  const serializedCache = new SerializedCache();
  const beaconEngineCore = new BeaconEngineCore({
    executionEngine,
    executionBuilderOpts,
    builderApiClientOpts,
    opts,
    ...(beaconEngineMode === BeaconEngineMode.Worker
      ? {
          chainConfigJson: chainConfigToJson(config),
          genesisValidatorsRoot: Uint8Array.from(config.genesisValidatorsRoot),
        }
      : {config}),
    logging: {type: "injected", logger},
    dbName,
    dataDir,
    dataColumnDir: dataColumnDir ?? path.join(dataDir, "data_columns"),
    metricsEnabled: metrics !== null,
    genesisTime: metadata.genesisTime,
    clock: beaconEngineMode === BeaconEngineMode.Worker ? undefined : clock,
    db: beaconEngineMode === BeaconEngineMode.Worker ? undefined : db,
    validatorMonitorOpts: modules.validatorMonitorOpts ?? null,
    isAnchorStateFinalized,
  });
  const beaconEngine = new BeaconEngine({
    logger,
    core: beaconEngineCore,
    config,
    emitter,
    clock,
    serializedCache,
    beaconEngineMode,
  });
  return {
    ...chainModules,
    serializedCache,
    beaconEngine,
    beaconEngineCore,
    abortController,
    clock,
    emitter,
    custodyConfig,
  };
}

/** Access the in-process core for tests that inspect or mutate consensus internals. */
export function getBeaconEngineCore(engine: IBeaconEngine): BeaconEngineCore {
  const core: unknown = Reflect.get(engine, "core");
  if (!(core instanceof BeaconEngineCore)) throw Error("Expected an in-process BeaconEngineCore");
  return core;
}
