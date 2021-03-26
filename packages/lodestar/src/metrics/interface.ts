/**
 * @module metrics
 */
import {Registry, Gauge, Counter} from "prom-client";

export interface IMetrics {
  registry: Registry;
}

/**
 * Metrics from:
 * https://github.com/ethereum/eth2.0-metrics/ and
 * https://hackmd.io/D5FmoeFZScim_squBFl8oA
 */
export interface IBeaconMetrics extends IMetrics {
  /**
   * Tracks the number of libp2p peers
   */
  peers: Gauge<string>;
  /**
   * Latest slot of the beacon chain state
   */
  slot: Gauge<string>;
  /**
   * Slot of the head block of the beacon chain
   */
  headSlot: Gauge<string>;
  /**
   * Root of the head block of the beacon chain
   */
  headRoot: Gauge<string>;
  /**
   * Current finalized epoch
   */
  finalizedEpoch: Gauge<string>;
  /**
   * Current finalized root
   */
  finalizedRoot: Gauge<string>;
  /**
   * Current justified epoch
   */
  currentJustifiedEpoch: Gauge<string>;
  /**
   * Current justified root
   */
  currentJustifiedRoot: Gauge<string>;
  /**
   * Current previously justified epoch
   */
  previousJustifiedEpoch: Gauge<string>;
  /**
   * Current previously justified root
   */
  previousJustifiedRoot: Gauge<string>;
  /**
   * Number of `status="pending|active|exited|withdrawable" validators in current epoch
   */
  currentValidators: Gauge<string>;
  /**
   * Number of `status="pending|active|exited|withdrawable" validators in current epoch
   */
  previousValidators: Gauge<string>;
  /**
   * Number of active validators that successfully included attestation on chain for current epoch
   */
  currentLiveValidators: Gauge<string>;
  /**
   * Number of active validators that successfully included attestation on chain for previous epoch
   */
  previousLiveValidators: Gauge<string>;
  /**
   * Number of pending deposits (`state.eth1Data.depositCount - state.eth1DepositIndex`)
   */
  pendingDeposits: Gauge<string>;
  /**
   * Number of total deposits included on chain
   */
  processedDepositsTotal: Gauge<string>;
  /**
   * Number of pending voluntary exits in local operation pool
   */
  pendingExits: Gauge<string>;
  /**
   * Number of blocks orphaned in the previous epoch
   */
  previousEpochOrphanedBlocks: Gauge<string>;
  /**
   * Total occurances of reorganizations of the chain
   */
  reorgEventsTotal: Counter<string>;
  /**
   * Track current epoch active balances
   */
  currentEpochActiveGwei: Gauge<string>;
  /**
   * Track current epoch active balances
   */
  currentEpochSourceGwei: Gauge<string>;
  /**
   * Track current epoch active balances
   */
  currentEpochTargetGwei: Gauge<string>;
  /**
   * Track previous epoch active balances
   */
  previousEpochActiveGwei: Gauge<string>;
  /**
   * Track previous epoch active balances
   */
  previousEpochSourceGwei: Gauge<string>;
  /**
   * Track previous epoch active balances
   */
  previousEpochTargetGwei: Gauge<string>;
  /**
   * Track number of attesters for which we have seen an attestation.
   * That attestation is not necessarily included on chain.
   */
  observedEpochAttesters: Gauge<string>;
  /**
   * Track number of aggregators for which we have seen an attestation.
   * That attestation is not necessarily included on chain.
   */
  observedEpochAggregators: Gauge<string>;
  /** Peers labeled by direction */
  peersByDirection: Gauge<string>;
  /** Number of peer:connected event, labeled by direction */
  peerConnectedEvent: Gauge<string>;
  /** Number of peer:disconnected event, labeled by direction */
  peerDisconnectedEvent: Gauge<string>;
  /** Number of goodbye received, labeled by reason */
  peerGoodbyeReceived: Gauge<string>;
  /** Number of goodbye sent, labeled by reason */
  peerGoodbyeSent: Gauge<string>;
  /** Total number of unique peers that have had a connection with */
  peersTotalUniqueConnected: Gauge<string>;

  /** Gossip mesh peer count by GossipType */
  gossipMeshPeersByType: Gauge<string>;
  /** Gossip mesh peer count by beacon attestation subnet */
  gossipMeshPeersByBeaconAttestationSubnet: Gauge<string>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IMetricsServer {}
