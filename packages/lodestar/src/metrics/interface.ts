/**
 * @module metrics
 */
import {Registry, Gauge, Counter} from "prom-client";

export interface IMetrics {
  registry: Registry;
}

export interface IBeaconMetrics extends IMetrics {
  peers: Gauge;
  currentSlot: Gauge;
  previousJustifiedEpoch: Gauge;
  currentJustifiedEpoch: Gauge;
  currentFinalizedEpoch: Gauge;
  previousEpochLiveValidators: Gauge;
  currentEpochLiveValidators: Gauge;
  reorgEventsTotal: Counter;
  pendingDeposits: Gauge;
  pendingExits: Gauge;
  totalDeposits: Gauge;
  previousEpochStaleBlocks: Gauge;
  propagatedAttestations: Gauge;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IMetricsServer {}
