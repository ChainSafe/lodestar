import {ModuleThread} from "@chainsafe/threads";
import {BeaconConfig, SpecJson} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {Metrics} from "../../../metrics/index.js";
import {QueueErrorCode} from "../../../util/queue/errors.js";

export type HistoricalStateRegenInitModules = {
  opts: {
    genesisTime: number;
    dbLocation: string;
    dataColumnDir: string;
    nativeStateTransition: boolean;
  };
  config: BeaconConfig;
  logger: LoggerNode;
  metrics: Metrics | null;
  signal?: AbortSignal;
};
export type HistoricalStateRegenModules = HistoricalStateRegenInitModules & {
  api: ModuleThread<HistoricalStateWorkerApi>;
};

export type HistoricalStateWorkerData = {
  chainConfigJson: SpecJson;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  dbLocation: string;
  dataColumnDir: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
  nativeStateTransition: boolean;
};

export type HistoricalStateWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  // Worker RPC strips custom Error fields, so queue errors cross as structured results.
  getHistoricalState(slot: number): Promise<Uint8Array | null | {error: QueueErrorCode}>;
};

export enum RegenErrorType {
  loadState = "load_state",
  invalidStateRoot = "invalid_state_root",
  blockProcessing = "block_processing",
}
