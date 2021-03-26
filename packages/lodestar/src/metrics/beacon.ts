/**
 * @module metrics
 */
import {Gauge, Counter} from "prom-client";

import {IBeaconMetrics} from "./interface";
import {IMetricsOptions} from "./options";
import {Metrics} from "./metrics";
import {readLodestarGitData} from "./gitData";
import {ILogger} from "@chainsafe/lodestar-utils";

export class BeaconMetrics extends Metrics implements IBeaconMetrics {
  peers: Gauge<string>;
  slot: Gauge<string>;
  headSlot: Gauge<string>;
  headRoot: Gauge<string>;
  finalizedEpoch: Gauge<string>;
  finalizedRoot: Gauge<string>;
  currentJustifiedEpoch: Gauge<string>;
  currentJustifiedRoot: Gauge<string>;
  previousJustifiedEpoch: Gauge<string>;
  previousJustifiedRoot: Gauge<string>;
  currentValidators: Gauge<string>;
  previousValidators: Gauge<string>;
  currentLiveValidators: Gauge<string>;
  previousLiveValidators: Gauge<string>;
  pendingDeposits: Gauge<string>;
  processedDepositsTotal: Gauge<string>;
  pendingExits: Gauge<string>;
  previousEpochOrphanedBlocks: Gauge<string>;
  reorgEventsTotal: Counter<string>;
  currentEpochActiveGwei: Gauge<string>;
  currentEpochSourceGwei: Gauge<string>;
  currentEpochTargetGwei: Gauge<string>;
  previousEpochActiveGwei: Gauge<string>;
  previousEpochSourceGwei: Gauge<string>;
  previousEpochTargetGwei: Gauge<string>;
  observedEpochAttesters: Gauge<string>;
  observedEpochAggregators: Gauge<string>;
  peersByDirection: Gauge<string>;
  peerConnectedEvent: Gauge<string>;
  peerDisconnectedEvent: Gauge<string>;
  peerGoodbyeReceived: Gauge<string>;
  peerGoodbyeSent: Gauge<string>;
  peersTotalUniqueConnected: Gauge<string>;
  gossipMeshPeersByType: Gauge<string>;
  gossipMeshPeersByBeaconAttestationSubnet: Gauge<string>;

  private lodestarVersion: Gauge<string>;
  private logger: ILogger;

  constructor(opts: IMetricsOptions, {logger}: {logger: ILogger}) {
    super(opts);
    const registers = [this.registry];
    this.logger = logger;
    this.peers = new Gauge({
      name: "libp2p_peers",
      help: "number of connected peers",
      registers,
    });
    this.slot = new Gauge({
      name: "beacon_slot",
      help: "latest slot",
      registers,
    });
    this.headSlot = new Gauge({
      name: "beacon_head_slot",
      help: "slot of the head block of the beacon chain",
      registers,
    });
    this.headRoot = new Gauge({
      name: "beacon_head_root",
      help: "root of the head block of the beacon chain",
      registers,
    });
    this.finalizedEpoch = new Gauge({
      name: "beacon_finalized_epoch",
      help: "current finalized epoch",
      registers,
    });
    this.finalizedRoot = new Gauge({
      name: "beacon_finalized_root",
      help: "current finalized root",
      registers,
    });
    this.currentJustifiedEpoch = new Gauge({
      name: "beacon_current_justified_epoch",
      help: "current justified epoch",
      registers,
    });
    this.currentJustifiedRoot = new Gauge({
      name: "beacon_current_justified_root",
      help: "current justified root",
      registers,
    });
    this.previousJustifiedEpoch = new Gauge({
      name: "beacon_previous_justified_epoch",
      help: "previous justified epoch",
      registers,
    });
    this.previousJustifiedRoot = new Gauge({
      name: "beacon_previous_justified_root",
      help: "previous justified root",
      registers,
    });
    this.currentValidators = new Gauge({
      name: "beacon_current_validators",
      labelNames: ["status"],
      help: "number of validators in current epoch",
      registers,
    });
    this.previousValidators = new Gauge({
      name: "beacon_previous_validators",
      labelNames: ["status"],
      help: "number of validators in previous epoch",
      registers,
    });
    this.currentLiveValidators = new Gauge({
      name: "beacon_current_live_validators",
      help: "number of active validators that successfully included attestation on chain for current epoch",
      registers,
    });
    this.previousLiveValidators = new Gauge({
      name: "beacon_previous_live_validators",
      help: "number of active validators that successfully included attestation on chain for previous epoch",
      registers,
    });
    this.pendingDeposits = new Gauge({
      name: "beacon_pending_deposits",
      help: "number of pending deposits",
      registers,
    });
    this.processedDepositsTotal = new Gauge({
      name: "beacon_processed_deposits_total",
      help: "number of total deposits included on chain",
      registers,
    });
    this.pendingExits = new Gauge({
      name: "beacon_pending_exits",
      help: "number of pending voluntary exits",
      registers,
    });
    this.previousEpochOrphanedBlocks = new Gauge({
      name: "beacon_previous_epoch_orphaned_blocks",
      help: "number of blocks not included into the chain in previous epoch",
      registers,
    });
    this.reorgEventsTotal = new Counter({
      name: "beacon_reorg_events_total",
      help: "number of chain reorganizations",
      registers,
    });
    this.currentEpochActiveGwei = new Gauge({
      name: "beacon_current_epoch_active_gwei",
      help: "current epoch active balances",
      registers,
    });
    this.currentEpochSourceGwei = new Gauge({
      name: "beacon_current_epoch_source_gwei",
      help: "current epoch source balances",
      registers,
    });
    this.currentEpochTargetGwei = new Gauge({
      name: "beacon_current_epoch_target_gwei",
      help: "current epoch target balances",
      registers,
    });
    this.previousEpochActiveGwei = new Gauge({
      name: "beacon_previous_epoch_active_gwei",
      help: "previous epoch active balances",
      registers,
    });
    this.previousEpochSourceGwei = new Gauge({
      name: "beacon_previous_epoch_source_gwei",
      help: "previous epoch source balances",
      registers,
    });
    this.previousEpochTargetGwei = new Gauge({
      name: "beacon_previous_epoch_target_gwei",
      help: "previous epoch target balances",
      registers,
    });
    this.observedEpochAttesters = new Gauge({
      name: "beacon_observed_epoch_attesters",
      help: "number of attesters for which we have seen an attestation, not necessarily included on chain.",
      registers,
    });
    this.observedEpochAggregators = new Gauge({
      name: "beacon_observed_epoch_aggregators",
      help: "number of aggregators for which we have seen an attestation, not necessarily included on chain.",
      registers,
    });

    // Extra Lodestar custom metrics

    this.peersByDirection = new Gauge({
      name: "lodestar_peers_by_direction",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
      registers,
    });

    this.peerConnectedEvent = new Gauge({
      name: "lodestar_peer_connected",
      help: "Number of peer:connected event, labeled by direction",
      labelNames: ["direction"],
      registers,
    });

    this.peerDisconnectedEvent = new Gauge({
      name: "lodestar_peer_disconnected",
      help: "Number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
      registers,
    });

    this.peerGoodbyeReceived = new Gauge({
      name: "lodestar_peer_goodbye_received",
      help: "Number of goodbye received, labeled by reason",
      labelNames: ["reason"],
      registers,
    });

    this.peerGoodbyeSent = new Gauge({
      name: "lodestar_peer_goodbye_sent",
      help: "Number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
      registers,
    });

    this.peersTotalUniqueConnected = new Gauge({
      name: "lodestar_peers_total_unique_connected",
      help: "Total number of unique peers that have had a connection with",
      registers,
    });

    this.gossipMeshPeersByType = new Gauge({
      name: "lodestar_gossip_mesh_peers_by_type",
      help: "Number of connected mesh peers per gossip type",
      labelNames: ["gossipType"],
      registers,
    });

    this.gossipMeshPeersByBeaconAttestationSubnet = new Gauge({
      name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet",
      help: "Number of connected mesh peers per beacon attestation subnet",
      labelNames: ["subnet"],
      registers,
    });

    // Private - only used once now
    this.lodestarVersion = new Gauge({
      name: "lodestar_version",
      help: "Lodestar version",
      labelNames: ["semver", "branch", "commit", "version"],
      registers,
    });
    this.lodestarVersion.set(readLodestarGitData(), 1);
  }
}
