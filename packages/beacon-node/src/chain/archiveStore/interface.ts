import {CheckpointWithHex} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";

export enum ArchiveMode {
  Frequency = "frequency",
  // New strategy to be implemented
  // WIP: https://github.com/ChainSafe/lodestar/pull/7005
  // Differential = "diff",
}

export interface StatesArchiveOpts {
  /**
   * Minimum number of epochs between archived states
   */
  archiveStateEpochFrequency: number;
  /**
   * Strategy to store archive states
   */
  archiveMode: ArchiveMode;
}

export type ArchiveStoreOpts = StatesArchiveOpts & {
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
  /**
   * Initialize archive store and load any worker required
   */
  init(): Promise<void>;
  /**
   * Cleanup and close any worker
   */
  close(): Promise<void>;
  /**
   * Scrape metrics from the archive store
   */
  scrapeMetrics(): Promise<string>;
  /**
   * Get historical state by slot
   */
  getHistoricalStateBySlot(
    slot: number
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null>;
  /**
   * Archive latest finalized state
   */
  persistToDisk(): Promise<void>;
}
