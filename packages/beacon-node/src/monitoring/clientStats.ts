import {DynamicProperty, MetricProperty, StaticProperty} from "./properties.js";
import {Client} from "./service.js";
import {ClientStats, JsonType, ProcessType} from "./types.js";

// Definition of client stats based on specification
// See https://docs.google.com/document/d/1qPWAVRjPCENlyAjUBwGkHMvz9qLdd_6u9DPZcNxDBpc

const CLIENT_STATS_SPEC_VERSION = 1;

const CLIENT_NAME = "lodestar";

export function createClientStats(client: Client, collectSystemStats?: boolean): ClientStats[] {
  const clientStats = [];

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
      value: CLIENT_NAME,
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
    syncEth1Connected: new MetricProperty({
      jsonKey: "sync_eth1_connected",
      metricName: "lodestar_execution_engine_http_client_config_urls_count",
      jsonType: JsonType.Boolean,
      defaultValue: false,
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
    syncEth1FallbackConfigured: new MetricProperty({
      jsonKey: "sync_eth1_fallback_configured",
      metricName: "lodestar_execution_engine_http_client_config_urls_count",
      threshold: 2,
      jsonType: JsonType.Boolean,
      defaultValue: false,
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
  return {
    ...createCommonStats(ProcessType.System),
    cpuCores: new DynamicProperty({
      jsonKey: "cpu_cores",
      provider: () => 0,
      cacheResult: true,
    }),
    cpuThreads: new DynamicProperty({
      jsonKey: "cpu_threads",
      provider: () => 0,
      cacheResult: true,
    }),
    cpuNodeSystemSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_system_seconds_total",
      provider: () => 0,
    }),
    cpuNodeUserSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_user_seconds_total",
      provider: () => 0,
    }),
    cpuNodeIOWaitSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_iowait_seconds_total",
      provider: () => 0,
    }),
    cpuNodeIdleSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_idle_seconds_total",
      provider: () => 0,
    }),
    memoryNodeBytesTotal: new DynamicProperty({
      jsonKey: "memory_node_bytes_total",
      provider: () => 0,
      cacheResult: true,
    }),
    memoryNodeBytesFree: new DynamicProperty({
      jsonKey: "memory_node_bytes_free",
      provider: () => 0,
    }),
    memoryNodeBytesCached: new DynamicProperty({
      jsonKey: "memory_node_bytes_cached",
      provider: () => 0,
    }),
    memoryNodeBytesBuffers: new DynamicProperty({
      jsonKey: "memory_node_bytes_buffers",
      provider: () => 0,
    }),
    diskNodeBytesTotal: new DynamicProperty({
      jsonKey: "disk_node_bytes_total",
      provider: () => 0,
    }),
    diskNodeBytesFree: new DynamicProperty({
      jsonKey: "disk_node_bytes_free",
      provider: () => 0,
    }),
    diskNodeIOSeconds: new DynamicProperty({
      jsonKey: "disk_node_io_seconds",
      provider: () => 0,
    }),
    diskNodeReadsTotal: new DynamicProperty({
      jsonKey: "disk_node_reads_total",
      provider: () => 0,
    }),
    diskNodeWritesTotal: new DynamicProperty({
      jsonKey: "disk_node_writes_total",
      provider: () => 0,
    }),
    networkNodeBytesTotalReceive: new DynamicProperty({
      jsonKey: "network_node_bytes_total_receive",
      provider: () => 0,
    }),
    networkNodeBytesTotalTransmit: new DynamicProperty({
      jsonKey: "network_node_bytes_total_transmit",
      provider: () => 0,
    }),
    miscNodeBootTsSeconds: new DynamicProperty({
      jsonKey: "misc_node_boot_ts_seconds",
      provider: () => 0,
    }),
    miscOs: new DynamicProperty({
      jsonKey: "misc_os",
      provider: () => "unk",
    }),
  };
}
