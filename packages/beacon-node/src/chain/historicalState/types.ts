import {ModuleThread} from "@chainsafe/threads";
import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {BeaconStateTransitionMetrics} from "@lodestar/state-transition";
import {Gauge, Histogram} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {StateArchiveMode} from "../archiver/interface.js";

export type HistoricalStateRegenInitModules = {
  opts: {
    genesisTime: number;
    dbLocation: string;
  };
  config: BeaconConfig;
  logger: LoggerNode;
  metrics: Metrics | null;
  signal?: AbortSignal;
  hierarchicalLayersConfig?: string;
  stateArchiveMode: StateArchiveMode;
};

export interface IHistoricalStateRegen {
  getHistoricalState(slot: number): Promise<Uint8Array | null>;
  storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void>;
}

export type HistoricalStateWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  getHistoricalState(slot: number, stateArchiveMode: StateArchiveMode): Promise<Uint8Array | null>;
  storeHistoricalState(slot: number, stateBytes: Uint8Array, stateArchiveMode: StateArchiveMode): Promise<void>;
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
  hierarchicalLayersConfig: string;
};

export enum RegenErrorType {
  loadState = "load_state",
  invalidStateRoot = "invalid_state_root",
  blockProcessing = "block_processing",
}

export type HistoricalStateRegenMetrics = BeaconStateTransitionMetrics & {
  regenTime: Histogram<{strategy: HistoricalStateStorageType}>;
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

export interface IStateDiffCodec {
  compute(base: Uint8Array, changed: Uint8Array): Uint8Array;
  apply(base: Uint8Array, delta: Uint8Array): Uint8Array;
}

export enum HistoricalStateStorageType {
  // Used to refer to full archive in `StateArchiveMode.Frequency`
  Full = "full",
  // Refer to the snapshot for differential backup
  Snapshot = "snapshot",
  // Refer to the binary diff for the differential backup
  Diff = "diff",
  // Refer to the slots with skipped backups during differential backup
  BlockReplay = "blockReplay",
}
