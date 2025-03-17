import {CheckpointWithHex} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";

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
  pruneHistory?: boolean;
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

export interface StateArchiveStrategy {
  onCheckpoint(stateRoot: RootHex, metrics?: Metrics | null): Promise<void>;
  onFinalizedCheckpoint(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
  maybeArchiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
  archiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
}

export interface IArchiveStore {
  init(): Promise<void>;
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  getHistoricalStateBySlot(
    slot: number
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
  persistToDisk(): Promise<void>;
}
