import {LoggerNodeOpts} from "@lodestar/logger/node";
import {WorkerServiceApi} from "../../system.js";

export enum ArchiveMode {
  Frequency = "frequency",
  // New strategy to be implemented
  // WIP: https://github.com/ChainSafe/lodestar/pull/7005
  // Differential = "diff",
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

export type ArchiverOpts = StatesArchiverOpts & {
  disableArchiveOnCheckpoint?: boolean;
  archiveBlobEpochs?: number;
  archiveDbPath?: string;
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

export type HistoricalStateApi = WorkerServiceApi<{
  getHistoricalState(slot: number): Promise<Uint8Array>;
}>;

export type HistoricalStateWorkerData = {
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  archiveDbPath: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
};

export enum RegenErrorType {
  loadState = "load_state",
  invalidStateRoot = "invalid_state_root",
  blockProcessing = "block_processing",
}
