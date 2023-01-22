import {DynamicProperty, MetricProperty, StaticProperty} from "./properties.js";
import {Client, ClientStats, JsonType, ProcessType} from "./types.js";

// Definition of client stats based on specification
// see https://docs.google.com/document/d/1qPWAVRjPCENlyAjUBwGkHMvz9qLdd_6u9DPZcNxDBpc

const CLIENT_STATS_SPEC_VERSION = 1;

export function createClientStats(client: Client, collectSystemStats?: boolean): ClientStats[] {
  const clientStats: ClientStats[] = [];

  if (client === "beacon") {
    clientStats.push(createBeaconNodeStats());
  } else if (client === "validator") {
    clientStats.push(createValidatorStats());
  }

  if (collectSystemStats) {
    clientStats.push(createSystemStats());
  }

  return clientStats;
}

function createCommonStats(process: ProcessType): ClientStats {
  return {
    version: new StaticProperty({
      jsonKey: "version",
      value: CLIENT_STATS_SPEC_VERSION,
    }),
    timestamp: new DynamicProperty({
      jsonKey: "timestamp",
      provider: Date.now,
    }),
    process: new StaticProperty({
      jsonKey: "process",
      value: process,
    }),
  };
}

function createProcessStats(process: ProcessType): ClientStats {
  return {
    ...createCommonStats(process),
    cpuProcessSecondsTotal: new MetricProperty({
      jsonKey: "cpu_process_seconds_total",
      metricName: "process_cpu_user_seconds_total",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    memoryProcessBytes: new MetricProperty({
      jsonKey: "memory_process_bytes",
      metricName: "process_resident_memory_bytes",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    clientName: new StaticProperty({
      jsonKey: "client_name",
      value: "lodestar",
    }),
    clientVersion: new MetricProperty({
      jsonKey: "client_version",
      metricName: "lodestar_version",
      fromLabel: "version",
      formatter: (value) => {
        // remove "v" prefix from value
        return (value as string).substring(1);
      },
      jsonType: JsonType.String,
      cacheResult: true,
      defaultValue: "",
    }),
    clientBuild: new StaticProperty({
      jsonKey: "client_build",
      value: 0,
    }),
    syncEth2FallbackConfigured: new StaticProperty({
      jsonKey: "sync_eth2_fallback_configured",
      value: false,
    }),
    syncEth2FallbackConnected: new StaticProperty({
      jsonKey: "sync_eth2_fallback_connected",
      value: false,
    }),
  };
}

function createBeaconNodeStats(): ClientStats {
  return {
    ...createProcessStats(ProcessType.BeaconNode),
    diskBeaconChainBytesTotal: new StaticProperty({
      jsonKey: "disk_beaconchain_bytes_total",
      value: 0,
    }),
    networkLibp2pBytesTotalReceive: new MetricProperty({
      jsonKey: "network_libp2p_bytes_total_receive",
      metricName: "libp2p_data_transfer_bytes_total",
      withLabel: {name: "protocol", value: "global received"},
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    networkLibp2pBytesTotalTransmit: new MetricProperty({
      jsonKey: "network_libp2p_bytes_total_transmit",
      metricName: "libp2p_data_transfer_bytes_total",
      withLabel: {name: "protocol", value: "global sent"},
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    networkPeersConnected: new MetricProperty({
      jsonKey: "network_peers_connected",
      metricName: "libp2p_peers",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    syncEth1Connected: new StaticProperty({
      jsonKey: "sync_eth1_connected",
      value: true,
    }),
    syncEth2Synced: new MetricProperty({
      jsonKey: "sync_eth2_synced",
      metricName: "lodestar_sync_status",
      rangeValue: 3,
      jsonType: JsonType.Boolean,
      defaultValue: true,
    }),
    syncBeaconHeadSlot: new MetricProperty({
      jsonKey: "sync_beacon_head_slot",
      metricName: "beacon_head_slot",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    syncEth1FallbackConfigured: new StaticProperty({
      jsonKey: "sync_eth1_fallback_configured",
      value: false,
    }),
    syncEth1FallbackConnected: new StaticProperty({
      jsonKey: "sync_eth1_fallback_connected",
      value: false,
    }),
    slasherActive: new StaticProperty({
      jsonKey: "slasher_active",
      value: false,
    }),
  };
}

function createValidatorStats(): ClientStats {
  return {
    ...createProcessStats(ProcessType.Validator),
    validatorTotal: new MetricProperty({
      jsonKey: "validator_total",
      metricName: "vc_indices_count",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
    validatorActive: new MetricProperty({
      jsonKey: "validator_active",
      metricName: "vc_indices_count",
      jsonType: JsonType.Number,
      defaultValue: 0,
    }),
  };
}

function createSystemStats(): ClientStats {
  return {};
}
