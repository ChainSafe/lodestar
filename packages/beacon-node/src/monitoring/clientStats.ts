import {DynamicProperty, MetricProperty, StaticProperty} from "./properties.js";
import {Client} from "./service.js";
import system from "./system.js";
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
      description: "Client Stats data specification version",
    }),
    timestamp: new DynamicProperty({
      jsonKey: "timestamp",
      provider: Date.now,
      description: "Unix timestamp in milliseconds",
    }),
    process: new StaticProperty({
      jsonKey: "process",
      value: process,
      description: "Process type, can be one of: validator, beaconnode, system",
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
      description: "CPU seconds consumed by the process",
    }),
    memoryProcessBytes: new MetricProperty({
      jsonKey: "memory_process_bytes",
      metricName: "process_resident_memory_bytes",
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Amount of memory in bytes allocated to the process",
    }),
    clientName: new StaticProperty({
      jsonKey: "client_name",
      value: CLIENT_NAME,
      description: "Name of client, e.g. lodestar, prysm, lighthouse, teku, nimbus",
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
      description: "Version of client, e.g. 1.3.0/2d0938e",
    }),
    clientBuild: new StaticProperty({
      jsonKey: "client_build",
      value: 0,
      description: "Incrementing integer representation of build for easier comparison",
    }),
    syncEth2FallbackConfigured: new StaticProperty({
      jsonKey: "sync_eth2_fallback_configured",
      value: false,
      description: "Whether the client has a fallback eth2 endpoint configured",
    }),
    syncEth2FallbackConnected: new StaticProperty({
      jsonKey: "sync_eth2_fallback_connected",
      value: false,
      description: "Whether the client is currently connected to a fallback eth2 endpoint",
    }),
  };
}

function createBeaconNodeStats(): ClientStats {
  return {
    ...createProcessStats(ProcessType.BeaconNode),
    diskBeaconChainBytesTotal: new MetricProperty({
      jsonKey: "disk_beaconchain_bytes_total",
      metricName: "lodestar_db_size_bytes_total",
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Amount of bytes consumed on disk by the beacon node's database",
    }),
    networkLibp2pBytesTotalReceive: new MetricProperty({
      jsonKey: "network_libp2p_bytes_total_receive",
      metricName: "libp2p_data_transfer_bytes_total",
      withLabel: {name: "protocol", value: "global received"},
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Number of bytes received via libp2p traffic",
    }),
    networkLibp2pBytesTotalTransmit: new MetricProperty({
      jsonKey: "network_libp2p_bytes_total_transmit",
      metricName: "libp2p_data_transfer_bytes_total",
      withLabel: {name: "protocol", value: "global sent"},
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Number of bytes transmitted via libp2p traffic",
    }),
    networkPeersConnected: new MetricProperty({
      jsonKey: "network_peers_connected",
      metricName: "libp2p_peers",
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Number of connected peers",
    }),
    syncEth1Connected: new MetricProperty({
      jsonKey: "sync_eth1_connected",
      metricName: "lodestar_execution_engine_http_client_config_urls_count",
      jsonType: JsonType.Boolean,
      defaultValue: false,
      description: "Whether the beacon node is connected to a eth1 node",
    }),
    syncEth2Synced: new MetricProperty({
      jsonKey: "sync_eth2_synced",
      metricName: "lodestar_sync_status",
      rangeValue: 3,
      jsonType: JsonType.Boolean,
      defaultValue: true,
      description: "Whether the beacon node is in sync with the beacon chain network",
    }),
    syncBeaconHeadSlot: new MetricProperty({
      jsonKey: "sync_beacon_head_slot",
      metricName: "beacon_head_slot",
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Slot of the head block of the beacon chain",
    }),
    syncEth1FallbackConfigured: new MetricProperty({
      jsonKey: "sync_eth1_fallback_configured",
      metricName: "lodestar_execution_engine_http_client_config_urls_count",
      threshold: 2,
      jsonType: JsonType.Boolean,
      defaultValue: false,
      description: "Whether the beacon node has a fallback eth1 endpoint configured",
    }),
    syncEth1FallbackConnected: new StaticProperty({
      jsonKey: "sync_eth1_fallback_connected",
      value: false,
      description: "Whether the beacon node is currently connected to a fallback eth1 endpoint",
    }),
    slasherActive: new StaticProperty({
      jsonKey: "slasher_active",
      value: false,
      description: "Whether slasher functionality is enabled",
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
      description: "Number of validator keys in use",
    }),
    validatorActive: new MetricProperty({
      jsonKey: "validator_active",
      metricName: "vc_indices_count",
      jsonType: JsonType.Number,
      defaultValue: 0,
      description: "Number of validator keys that are currently active",
    }),
  };
}

function createSystemStats(): ClientStats {
  return {
    ...createCommonStats(ProcessType.System),
    cpuCores: new DynamicProperty({
      jsonKey: "cpu_cores",
      provider: () => system.cpuCores,
      description: "Number of CPU cores available",
    }),
    cpuThreads: new DynamicProperty({
      jsonKey: "cpu_threads",
      provider: () => system.cpuThreads,
      description: "Number of CPU threads available",
    }),
    cpuNodeSystemSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_system_seconds_total",
      provider: () => system.cpuNodeSystemSecondsTotal,
      description: "CPU seconds consumed by all processes",
    }),
    cpuNodeUserSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_user_seconds_total",
      provider: () => system.cpuNodeUserSecondsTotal,
      description: "CPU seconds consumed by user processes",
    }),
    cpuNodeIOWaitSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_iowait_seconds_total",
      provider: () => system.cpuNodeIOWaitSecondsTotal,
      description: "CPU seconds spent in I/O wait state",
    }),
    cpuNodeIdleSecondsTotal: new DynamicProperty({
      jsonKey: "cpu_node_idle_seconds_total",
      provider: () => system.cpuNodeIdleSecondsTotal,
      description: "CPU seconds spent in idle state",
    }),
    memoryNodeBytesTotal: new DynamicProperty({
      jsonKey: "memory_node_bytes_total",
      provider: () => system.memoryNodeBytesTotal,
      description: "Total amount of memory in bytes available",
    }),
    memoryNodeBytesFree: new DynamicProperty({
      jsonKey: "memory_node_bytes_free",
      provider: () => system.memoryNodeBytesFree,
      description: "Amount of free memory in bytes",
    }),
    memoryNodeBytesCached: new DynamicProperty({
      jsonKey: "memory_node_bytes_cached",
      provider: () => system.memoryNodeBytesCached,
      description: "Amount of memory in bytes used by cache",
    }),
    memoryNodeBytesBuffers: new DynamicProperty({
      jsonKey: "memory_node_bytes_buffers",
      provider: () => system.memoryNodeBytesBuffers,
      description: "Amount of memory in bytes used by buffers",
    }),
    diskNodeBytesTotal: new DynamicProperty({
      jsonKey: "disk_node_bytes_total",
      provider: () => system.diskNodeBytesTotal,
      description: "Total amount of available disk space in bytes",
    }),
    diskNodeBytesFree: new DynamicProperty({
      jsonKey: "disk_node_bytes_free",
      provider: () => system.diskNodeBytesFree,
      description: "Amount of free disk space in bytes",
    }),
    diskNodeIOSeconds: new DynamicProperty({
      jsonKey: "disk_node_io_seconds",
      provider: () => system.diskNodeIOSeconds,
      description: "Total time spent in seconds on disk I/O operations",
    }),
    diskNodeReadsTotal: new DynamicProperty({
      jsonKey: "disk_node_reads_total",
      provider: () => system.diskNodeReadsTotal,
      description: "Total number of disk read I/O operations",
    }),
    diskNodeWritesTotal: new DynamicProperty({
      jsonKey: "disk_node_writes_total",
      provider: () => system.diskNodeWritesTotal,
      description: "Total number of disk write I/O operations",
    }),
    networkNodeBytesTotalReceive: new DynamicProperty({
      jsonKey: "network_node_bytes_total_receive",
      provider: () => system.networkNodeBytesTotalReceive,
      description: "Total amount of bytes received over the network",
    }),
    networkNodeBytesTotalTransmit: new DynamicProperty({
      jsonKey: "network_node_bytes_total_transmit",
      provider: () => system.networkNodeBytesTotalTransmit,
      description: "Total amount of bytes transmitted over the network",
    }),
    miscNodeBootTsSeconds: new DynamicProperty({
      jsonKey: "misc_node_boot_ts_seconds",
      provider: () => system.miscNodeBootTsSeconds,
      description: "Unix timestamp in seconds of boot time",
    }),
    miscOs: new DynamicProperty({
      jsonKey: "misc_os",
      provider: () => system.miscOs,
      description: "Operating system, can be one of: lin, win, mac, unk for unknown",
    }),
  };
}
