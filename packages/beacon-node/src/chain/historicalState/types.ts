import {ModuleThread} from "@chainsafe/threads";
import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {Metrics} from "../../metrics/index.js";

export type HistoricalStateRegenInitModules = {
  opts: {
    genesisTime: number;
    dbLocation: string;
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
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  dbLocation: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
};

export type HistoricalStateWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  getHistoricalState(slot: number): Promise<Uint8Array>;
};
