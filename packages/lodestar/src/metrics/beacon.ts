/**
 * @module metrics
 */
import {Gauge, Counter} from "prom-client";

import {IBeaconMetrics} from "./interface";
import {IMetricsOptions} from "./options";
import {Metrics} from "./metrics";
import {ILogger} from "@chainsafe/lodestar-utils";

export class BeaconMetrics extends Metrics implements IBeaconMetrics {
  public peers: Gauge;
  public slot: Gauge;
  public headSlot: Gauge;
  public headRoot: Gauge;
  public finalizedEpoch: Gauge;
  public finalizedRoot: Gauge;
  public currentJustifiedEpoch: Gauge;
  public currentJustifiedRoot: Gauge;
  public previousJustifiedEpoch: Gauge;
  public previousJustifiedRoot: Gauge;
  public currentValidators: Gauge;
  public previousValidators: Gauge;
  public currentLiveValidators: Gauge;
  public previousLiveValidators: Gauge;
  public pendingDeposits: Gauge;
  public processedDepositsTotal: Gauge;
  public pendingExits: Gauge;
  public previousEpochOrphanedBlocks: Gauge;
  public reorgEventsTotal: Counter;
  public currentEpochActiveGwei: Gauge;
  public currentEpochSourceGwei: Gauge;
  public currentEpochTargetGwei: Gauge;
  public previousEpochActiveGwei: Gauge;
  public previousEpochSourceGwei: Gauge;
  public previousEpochTargetGwei: Gauge;
  public observedEpochAttesters: Gauge;
  public observedEpochAggregators: Gauge;
  public blockProcessorTotalAsyncTime: Gauge;
  peersByDirection: Gauge;
  peerConnectedEvent: Gauge;
  peerDisconnectedEvent: Gauge;
  peerGoodbyeReceived: Gauge;
  peerGoodbyeSent: Gauge;

  private logger: ILogger;

  public constructor(opts: IMetricsOptions, {logger}: {logger: ILogger}) {
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

    this.blockProcessorTotalAsyncTime = new Gauge({
      name: "lodestar_block_processor_total_async_time",
      help: "Total number of seconds spent completing block processor async jobs",
      registers,
    });

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
  }

  public start(): void {
    super.start();
  }

  public stop(): void {
    super.stop();
  }
}
