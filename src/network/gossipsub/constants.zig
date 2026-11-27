const std = @import("std");

/// Maximum uncompressed gossip payload, shared with the req/resp domain.
pub const MAX_PAYLOAD_SIZE = @import("../constants.zig").MAX_PAYLOAD_SIZE;

/// Snappy's worst-case compressed length for a payload of `n` bytes.
pub const maxCompressedLen = @import("../constants.zig").maxCompressedLen;

/// `GOSSIP_MAX_SIZE`: the bound on a whole encoded RPC frame, per the consensus
/// p2p-interface `max_message_size()`.
pub const GOSSIP_MAX_SIZE: usize = @max(maxCompressedLen(MAX_PAYLOAD_SIZE) + 1024, 1024 * 1024);

/// 4-byte message-id domains that isolate valid from invalid snappy payloads.
pub const MESSAGE_DOMAIN_VALID_SNAPPY = [4]u8{ 0x01, 0x00, 0x00, 0x00 };
pub const MESSAGE_DOMAIN_INVALID_SNAPPY = [4]u8{ 0x00, 0x00, 0x00, 0x00 };
pub const message_id_length: usize = 20;

/// Mesh degree parameters (Ethereum overrides of the gossipsub defaults).
pub const mesh_d: u8 = 8;
pub const mesh_d_low: u8 = 6;
pub const mesh_d_high: u8 = 12;
pub const mesh_d_lazy: u8 = 6;
pub const mesh_d_out: u8 = 2;
pub const mesh_d_score: u8 = 4;

/// Timers, in milliseconds unless noted.
pub const heartbeat_interval_ms: u64 = 700;
pub const fanout_ttl_ms: u64 = 60_000;
pub const prune_backoff_ms: u64 = 60_000;
pub const unsubscribe_backoff_ms: u64 = 10_000;
pub const backoff_slack_heartbeats: u64 = 2;
/// A GRAFT arriving within this long after we PRUNE a peer is graft flooding and
/// draws a second behavioural penalty.
pub const graft_flood_threshold_ms: u64 = 10_000;
pub const default_iwant_followup_ms: u64 = 3_000;
pub const opportunistic_graft_ms: u64 = 60_000;
pub const opportunistic_graft_peers: u8 = 2;
/// The seen-cache holds message ids for two epochs; the host supplies the slot
/// duration so the window tracks the active preset.
pub const seen_ttl_epochs: u64 = 2;

/// Message-cache windows: full messages retained for `mcache_len` heartbeats,
/// gossiped about for `mcache_gossip` of them.
pub const mcache_len: usize = 6;
pub const mcache_gossip: usize = 3;
pub const maintenance_slice_target_ns: u64 = 1_000_000;

/// Only announce IDONTWANT for messages at least this large, so small topics
/// (attestations) are not burdened; blocks and data columns clear it.
pub const default_idontwant_min_data_size: usize = 16 * 1024;

/// Per-RPC and per-heartbeat element caps beyond `GOSSIP_MAX_SIZE`.
/// One frame can unsubscribe the old namespace and subscribe the new namespace.
pub const max_subscriptions_per_rpc: usize = 2 * topics_cap;
pub const max_publish_per_rpc: usize = 4_096;
pub const max_control_per_rpc: usize = 4_096;
pub const max_ihave_per_heartbeat: usize = 10;
pub const max_ihave_ids_per_heartbeat: usize = 5_000;
pub const max_iwant_ids_per_rpc: usize = 5_000;
pub const max_idontwant_per_heartbeat: usize = 512;
pub const gossip_retransmission: u2 = 3;

pub fn seenTtlMs(slots_per_epoch: u64, seconds_per_slot: u64) u64 {
    return seconds_per_slot * 1000 * slots_per_epoch * seen_ttl_epochs;
}

/// Connected peers, retained peer identities, and simultaneously requested local topics.
pub const peers_cap: usize = 256;
pub const retained_peers_cap: u16 = 576;
pub const topics_cap: usize = 512;
/// Message ids a single peer may suppress at once through IDONTWANT.
pub const dont_send_cap: usize = 512;

/// Ordinary inbound frames use the body buffer; larger frames claim a shared lease.
pub const body_buffer_len: usize = 64 * 1024;
pub const read_scratch_len: usize = 16 * 1024;

/// Outstanding IWANT promises tracked at once, and the ids carried in one
/// emitted IHAVE or requested in one IWANT.
pub const promises_cap: usize = 8_192;
pub const gossip_ids_max: usize = 128;

comptime {
    std.debug.assert(graft_flood_threshold_ms <= prune_backoff_ms);
    std.debug.assert(mesh_d_low <= mesh_d);
    std.debug.assert(mesh_d <= mesh_d_high);
    std.debug.assert(mesh_d_out <= mesh_d_low);
    std.debug.assert(mesh_d_score <= mesh_d);
    std.debug.assert(mcache_gossip <= mcache_len);
    std.debug.assert(GOSSIP_MAX_SIZE >= 1024 * 1024);
    std.debug.assert(message_id_length == 20);
}

/// Per-peer data allowance includes room for one maximum local publication after forward saturation.
pub const tx_peer_bytes = 2 * maxCompressedLen(MAX_PAYLOAD_SIZE);
pub const tx_local_bytes = maxCompressedLen(MAX_PAYLOAD_SIZE);
pub const tx_local_descriptors = 32;
pub const fields_per_peer = 32_768;
pub const fields_per_pump = 131_072;
