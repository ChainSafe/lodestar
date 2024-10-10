import {ModuleThread} from "@chainsafe/threads";
import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {BeaconStateTransitionMetrics} from "@lodestar/state-transition";
import {Gauge, Histogram} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {DiffLayers} from "./diffLayers.js";

export type HistoricalStateRegenInitModules = {
  opts: {
    genesisTime: number;
    dbLocation: string;
  };
  config: BeaconConfig;
  logger: LoggerNode;
  metrics: Metrics | null;
  signal?: AbortSignal;
  diffLayers?: DiffLayers;
};
export type HistoricalStateRegenModules = HistoricalStateRegenInitModules & {
  api: ModuleThread<HistoricalStateWorkerApi>;
};

export type HistoricalStateWorkerData = {
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  dbLocation: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
  diffLayers: string;
};

export type HistoricalStateWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  getHistoricalState(slot: number): Promise<Uint8Array | null>;
  storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void>;
};

export interface IHistoricalStateRegen {
  getHistoricalState(slot: number): Promise<Uint8Array | null>;
  storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void>;
}

export enum RegenErrorType {
  loadState = "load_state",
  invalidStateRoot = "invalid_state_root",
  blockProcessing = "block_processing",
}

export type HistoricalStateRegenMetrics = BeaconStateTransitionMetrics & {
  regenTime: Histogram<{strategy: StateArchiveStrategy}>;
  loadSnapshotStateTime: Histogram;
  loadDiffStateTime: Histogram;
  stateTransitionTime: Histogram;
  stateTransitionBlocks: Histogram;
  stateSerializationTime: Histogram;
  regenRequestCount: Gauge;
  regenSuccessCount: Gauge;
  regenErrorCount: Gauge<{reason: RegenErrorType}>;
  stateDiffSize: Gauge;
  stateSnapshotSize: Gauge;
};

export enum StateArchiveStrategy {
  Snapshot = "snapshot",
  Diff = "diff",
  BlockReplay = "blockReplay",
}

export interface IBinaryDiffCodec {
  init(): Promise<void>;
  initialized: boolean;
  compute(base: Uint8Array, changed: Uint8Array): Uint8Array;
  apply(base: Uint8Array, delta: Uint8Array): Uint8Array;
}
