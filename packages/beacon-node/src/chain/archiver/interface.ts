import {CheckpointWithHex} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";

export enum StateArchiveMode {
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
  stateArchiveMode: StateArchiveMode;
}

export type ArchiverOpts = StatesArchiverOpts & {
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

export interface StateArchiveStrategy {
  onCheckpoint(stateRoot: RootHex, metrics?: Metrics | null): Promise<void>;
  onFinalizedCheckpoint(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
  maybeArchiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
  archiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void>;
}
