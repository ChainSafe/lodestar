import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {BeaconStateTransitionMetrics} from "@lodestar/state-transition";
import {Gauge, Histogram} from "@lodestar/utils";
import {LodestarService} from "../../interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {DifferentialLayers} from "./utils/differentialLayers.js";

export enum ArchiveMode {
  Frequency = "frequency",
  Differential = "diff",
}

export interface StatesArchiverOpts {
  /**
   * Minimum number of epochs between archived states
   */
  archiveStateEpochFrequency: number;
  /**
   * Strategy to store archive states
   */
  archiveMode: ArchiveMode;
}

export type ArchiveStoreOpts = StatesArchiverOpts & {
  disableArchiveOnCheckpoint?: boolean;
  archiveBlobEpochs?: number;
};

export type ProposalStats = {
  total: number;
  finalized: number;
  orphaned: number;
  missed: number;
};

export type FinalizedStats = {
  allValidators: ProposalStats;
  attachedValidators: ProposalStats;
  finalizedCanonicalCheckpointsCount: number;
  finalizedFoundCheckpointsInStateCache: number;
  finalizedAttachedValidatorsCount: number;
};

export type HistoricalStateServiceModules = {
  api: LodestarService<HistoricalStateServiceApi>;
  logger: LoggerNode;
  metrics: Metrics | null;
};

export type HistoricalStateServiceInitModules = {
  config: BeaconConfig;
  logger: LoggerNode;
  diffLayers?: DifferentialLayers;
  metrics: Metrics | null;
};

export type HistoricalStateServiceData = {
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

export type HistoricalStateServiceApi = {
  getHistoricalState(slot: number): Promise<Uint8Array | null>;
  storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void>;
};

export enum RegenErrorType {
  loadState = "load_state",
  invalidStateRoot = "invalid_state_root",
  blockProcessing = "block_processing",
}

export type HistoricalStateMetrics = BeaconStateTransitionMetrics & {
  regenTime: Histogram<{strategy: DifferentialArchiveStrategy}>;
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

export enum DifferentialArchiveStrategy {
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
