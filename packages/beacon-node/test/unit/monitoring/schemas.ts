// See https://docs.google.com/document/d/1qPWAVRjPCENlyAjUBwGkHMvz9qLdd_6u9DPZcNxDBpc

export type ClientStatsSchema = {key: string; type: "string" | "number" | "boolean"}[];

export const commonStatsSchema: ClientStatsSchema = [
  {key: "version", type: "number"},
  {key: "timestamp", type: "number"},
  {key: "process", type: "string"},
];

export const processStatsSchema: ClientStatsSchema = [
  ...commonStatsSchema,
  {key: "cpu_process_seconds_total", type: "number"},
  {key: "memory_process_bytes", type: "number"},
  {key: "client_name", type: "string"},
  {key: "client_version", type: "string"},
  {key: "client_build", type: "number"},
  {key: "sync_eth2_fallback_configured", type: "boolean"},
  {key: "sync_eth2_fallback_connected", type: "boolean"},
];

export const beaconNodeStatsSchema: ClientStatsSchema = [
  ...processStatsSchema,
  {key: "disk_beaconchain_bytes_total", type: "number"},
  {key: "network_libp2p_bytes_total_receive", type: "number"},
  {key: "network_libp2p_bytes_total_transmit", type: "number"},
  {key: "network_peers_connected", type: "number"},
  {key: "sync_eth1_connected", type: "boolean"},
  {key: "sync_eth2_synced", type: "boolean"},
  {key: "sync_beacon_head_slot", type: "number"},
  {key: "sync_eth1_fallback_configured", type: "boolean"},
  {key: "sync_eth1_fallback_connected", type: "boolean"},
  {key: "slasher_active", type: "boolean"},
];

export const validatorStatsSchema: ClientStatsSchema = [
  ...processStatsSchema,
  {key: "validator_total", type: "number"},
  {key: "validator_active", type: "number"},
];

export const systemStatsSchema: ClientStatsSchema = [
  ...commonStatsSchema,
  {key: "cpu_cores", type: "number"},
  {key: "cpu_threads", type: "number"},
  {key: "cpu_node_system_seconds_total", type: "number"},
  {key: "cpu_node_user_seconds_total", type: "number"},
  {key: "cpu_node_iowait_seconds_total", type: "number"},
  {key: "cpu_node_idle_seconds_total", type: "number"},
  {key: "memory_node_bytes_total", type: "number"},
  {key: "memory_node_bytes_free", type: "number"},
  {key: "memory_node_bytes_cached", type: "number"},
  {key: "memory_node_bytes_buffers", type: "number"},
  {key: "disk_node_bytes_total", type: "number"},
  {key: "disk_node_bytes_free", type: "number"},
  {key: "disk_node_io_seconds", type: "number"},
  {key: "disk_node_reads_total", type: "number"},
  {key: "disk_node_writes_total", type: "number"},
  {key: "network_node_bytes_total_receive", type: "number"},
  {key: "network_node_bytes_total_transmit", type: "number"},
  {key: "misc_node_boot_ts_seconds", type: "number"},
  {key: "misc_os", type: "string"},
];
