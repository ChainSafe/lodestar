/**
 * @module metrics
 */
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {collectDefaultMetrics, Counter, Gauge, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";
import {DbMetricLabels, IDbMetrics} from "@chainsafe/lodestar-db";
import {createBeaconMetrics, IBeaconMetrics} from "./metrics/beacon";
import {createLodestarMetrics, ILodestarMetrics} from "./metrics/lodestar";
import {IMetricsOptions} from "./options";
import {RegistryMetricCreator} from "./utils/registryMetricCreator";
import {createValidatorMonitor, IValidatorMonitor} from "./validatorMonitor";
import {IDiscv5Metrics} from "@chainsafe/discv5";

export type IMetrics = IBeaconMetrics & ILodestarMetrics & IValidatorMonitor & {register: Registry};

export function createMetrics(
  opts: IMetricsOptions,
  config: IChainForkConfig,
  anchorState: allForks.BeaconState,
  registries: Registry[] = []
): IMetrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, anchorState);

  const genesisTime = anchorState.genesisTime;
  const validatorMonitor = createValidatorMonitor(lodestar, config, genesisTime);
  // Register a single collect() function to run all validatorMonitor metrics
  lodestar.validatorMonitor.validatorsTotal.addCollect(() => {
    const clockSlot = getCurrentSlot(config, genesisTime);
    validatorMonitor.scrapeMetrics(clockSlot);
  });
  process.on("unhandledRejection", (_error) => {
    lodestar.unhandeledPromiseRejections.inc();
  });

  collectDefaultMetrics({
    register,
    // eventLoopMonitoringPrecision with sampling rate in milliseconds
    eventLoopMonitoringPrecision: 10,
  });

  // Collects GC metrics using a native binding module
  // - nodejs_gc_runs_total: Counts the number of time GC is invoked
  // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
  // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
  gcStats(register)();

  return {...beacon, ...lodestar, ...validatorMonitor, register: Registry.merge([register, ...registries])};
}

export function createDbMetrics(): {metrics: IDbMetrics; registry: Registry} {
  const metrics = {
    dbReads: new Counter<DbMetricLabels>({
      name: "lodestar_db_reads",
      labelNames: ["bucket"],
      help: "Number of db reads, contains bucket label.",
    }),
    dbWrites: new Counter<DbMetricLabels>({
      name: "lodestar_db_writes",
      labelNames: ["bucket"],
      help: "Number of db writes and deletes, contains bucket label.",
    }),
  };
  const registry = new Registry();
  registry.registerMetric(metrics.dbReads);
  registry.registerMetric(metrics.dbWrites);
  return {metrics, registry};
}

export function createDiscv5Metrics(): {metrics: IDiscv5Metrics; registry: Registry} {
  const metrics = {
    kadTableSize: new Gauge({
      name: "lodestar_discv5_kad_table_size",
      help: "Total size of the discv5 kad table",
    }) as Gauge<string> & {collect(): void},
    activeSessionCount: new Gauge({
      name: "lodestar_discv5_active_session_count",
      help: "Count of the discv5 active sessions",
    }) as Gauge<string> & {collect(): void},
    connectedPeerCount: new Gauge({
      name: "lodestar_discv5_connected_peer_count",
      help: "Count of the discv5 connected peers",
    }) as Gauge<string> & {collect(): void},
    sentMessageCount: new Gauge<"type">({
      name: "lodestar_discv5_sent_message_count",
      help: "Count of the discv5 messages sent by message type",
      labelNames: ["type"],
    }) as Gauge<"type"> & {collect(): void},
    rcvdMessageCount: new Gauge<"type">({
      name: "lodestar_discv5_rcvd_message_count",
      help: "Count of the discv5 messages received by message type",
      labelNames: ["type"],
    }) as Gauge<"type"> & {collect(): void},
  };
  const registry = new Registry();
  Object.keys(metrics).forEach((metricName) => registry.registerMetric(metrics[metricName as keyof typeof metrics]));
  return {metrics, registry};
}
