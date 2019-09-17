/**
 * @module metrics
 */
import {Gauge, Counter} from "prom-client";

import {IBeaconMetrics} from "./interface";
import {IMetricsOptions} from "./options";
import {Metrics} from "./metrics";


export class BeaconMetrics extends Metrics implements IBeaconMetrics {
  public peers: Gauge;
  public currentSlot: Gauge;
  public previousJustifiedEpoch: Gauge;
  public currentJustifiedEpoch: Gauge;
  public currentFinalizedEpoch: Gauge;
  public previousEpochLiveValidators: Gauge;
  public currentEpochLiveValidators: Gauge;
  public reorgEventsTotal: Counter;
  public pendingDeposits: Gauge;
  public pendingExits: Gauge;
  public totalDeposits: Gauge;
  public previousEpochStaleBlocks: Gauge;
  public propagatedAttestations: Gauge;

  public constructor(opts: IMetricsOptions) {
    super(opts);
    const registers = [this.registry];
    this.peers = new Gauge({
      name: "beaconchain_peers",
      help: "number of connected peers",
      registers,
    });
    this.currentSlot = new Gauge({
      name: "beaconchain_current_slot",
      help: "latest slot",
      registers,
    });
    this.previousJustifiedEpoch = new Gauge({
      name: "beaconchain_current_prev_justified_epoch",
      help: "previous justified epoch",
      registers,
    });
    this.currentJustifiedEpoch = new Gauge({
      name: "beaconchain_current_justified_epoch",
      help: "current justified epoch",
      registers,
    });
    this.currentFinalizedEpoch = new Gauge({
      name: "beaconchain_current_finalized_epoch",
      help: "current finalized epoch",
      registers,
    });
    this.previousEpochLiveValidators = new Gauge({
      name: "beaconchain_previous_epoch_live_validators",
      help: "number of active validators in previous epoch",
      registers,
    });
    this.currentEpochLiveValidators = new Gauge({
      name: "beaconchain_current_epoch_live_validators",
      help: "number of active validators in current epoch",
      registers,
    });
    this.reorgEventsTotal = new Counter({
      name: "beaconchain_reorg_events_total",
      help: "number of chain reorganizations",
      registers,
    });
    this.pendingDeposits = new Gauge({
      name: "beaconchain_pending_deposits",
      help: "number of pending deposits",
      registers,
    });
    this.pendingExits = new Gauge({
      name: "beaconchain_pending_exits",
      help: "number of pending voluntary exits",
      registers,
    });
    this.totalDeposits = new Gauge({
      name: "beaconchain_total_deposits",
      help: "number of total deposits",
      registers,
    });
    this.previousEpochStaleBlocks = new Gauge({
      name: "beaconchain_previous_epoch_stale_blocks",
      help: "number of blocks not included into the chain in previous epoch",
      registers,
    });
    this.propagatedAttestations = new Gauge({
      name: "beaconchain_propagated_attestations",
      help: "number of distinct attestations received",
      registers,
    });
  }

  public async start(): Promise<void> {
    await super.start();
  }

  public async stop(): Promise<void> {
    await super.stop();
  }
}
