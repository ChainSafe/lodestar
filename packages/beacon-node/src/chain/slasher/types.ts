import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";

/**
 * Configuration for the lazy slasher.
 *
 * The lazy slasher uses aggregate min-max functions instead of per-validator tracking,
 * reducing storage from gigabytes to ~65KB while maintaining detection capability.
 *
 * @see https://ethresear.ch/t/a-lazy-approach-to-slashers/22041
 */
export interface LazySlasherConfig {
  /**
   * Enable the lazy slasher.
   * When disabled, the node only validates incoming slashings but doesn't detect new ones.
   */
  enabled: boolean;

  /**
   * Number of epochs of history to track for surround vote detection.
   * Should cover the weak subjectivity period (~4096 epochs on mainnet).
   * Default: 4096
   */
  historyLength: number;

  /**
   * Number of recent epochs to eagerly update aggregate state for.
   * Larger values catch more edge cases but increase CPU cost per attestation.
   * The aggregate is O(updateWindow) per attestation vs O(historyLength).
   * Default: 64 (covers ~6.8 hours, sufficient for most slashing scenarios)
   */
  updateWindow: number;

  /**
   * Whether to broadcast discovered slashings to the network.
   * Default: true
   */
  broadcastSlashings: boolean;
}

export const defaultLazySlasherConfig: LazySlasherConfig = {
  enabled: false,
  historyLength: 4096,
  updateWindow: 64,
  broadcastSlashings: true,
};

/**
 * Aggregate min-max state for lazy slashing detection.
 *
 * Instead of tracking per-validator min-max values, we track aggregates across all validators.
 * This allows detecting potential surrounds with minimal storage, then verifying on-demand.
 */
export interface AggregateMinMax {
  /**
   * m(i) = minimum target epoch seen for any attestation with source > i
   * If m(s) exists and new attestation has target > m(s), there might be a surround.
   */
  minTargetBySource: Map<Epoch, Epoch>;

  /**
   * M(i) = maximum target epoch seen for any attestation with source < i
   * If M(s) exists and new attestation has target < M(s), it might be surrounded.
   */
  maxTargetBySource: Map<Epoch, Epoch>;
}

/**
 * Attestation data extracted for slashing detection.
 */
export interface AttestationRecord {
  /** Source checkpoint epoch */
  sourceEpoch: Epoch;
  /** Target checkpoint epoch */
  targetEpoch: Epoch;
  /** Slot the attestation was created */
  slot: Slot;
  /** Root of the attestation data (for deduplication) */
  dataRoot: RootHex;
  /** Attesting validator indices */
  attestingIndices: ValidatorIndex[];
}

/**
 * Result when checking for potential surrounds.
 */
export type SurroundCheckResult =
  | {type: "none"}
  | {
      type: "surrounds";
      /** The new attestation potentially surrounds something */
      triggerAttestation: AttestationRecord;
      /** Min target epoch that might be surrounded */
      surroundedTargetEpoch: Epoch;
      /** Epochs to search for the surrounded attestation (target, target+1) */
      searchEpochs: [Epoch, Epoch];
    }
  | {
      type: "surrounded";
      /** The new attestation is potentially surrounded by something */
      triggerAttestation: AttestationRecord;
      /** Max target epoch of the surrounding attestation */
      surroundingTargetEpoch: Epoch;
      /** Epochs to search for the surrounding attestation */
      searchEpochs: [Epoch, Epoch];
    };

/**
 * Slashing candidate found during on-demand verification.
 */
export interface SlashingCandidate {
  /** Type of slashable offense */
  type: "surround" | "double-vote";
  /** Index of the slashable validator */
  validatorIndex: ValidatorIndex;
  /** First attestation (the one that was stored/in-block) */
  attestation1: AttestationRecord;
  /** Second attestation (the one that triggered detection) */
  attestation2: AttestationRecord;
}

/**
 * Metrics for the lazy slasher.
 */
export interface LazySlasherMetrics {
  /** Number of attestations processed */
  attestationsProcessed: number;
  /** Number of surround checks triggered (where aggregate suggested possible surround) */
  surroundChecksTriggered: number;
  /** Number of actual slashings found */
  slashingsFound: number;
  /** Number of false positives (surround check triggered but no actual slashing) */
  falsePositives: number;
  /** Current size of minTargetBySource map */
  minTargetMapSize: number;
  /** Current size of maxTargetBySource map */
  maxTargetMapSize: number;
}
