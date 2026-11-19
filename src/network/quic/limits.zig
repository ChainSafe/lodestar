const std = @import("std");
const constants = @import("../constants.zig");

pub const connections_max_default: u16 = 128;
pub const connections_max_ceiling: u16 = 1_024;
pub const handshaking_max: u16 = 32;
pub const handshaking_per_source_max: u16 = 4;
pub const dialing_max: u16 = 32;
pub const peer_streams_bidi: u64 = 64;
pub const streams_per_connection: u16 = 128;
pub const idle_timeout_ms: u64 = 10_000;
pub const keep_alive_ms: u64 = 5_000;
pub const handshake_timeout_ms: u64 = 5_000;
/// A dial that has received nothing after quiche's second probe timeout (initial RTT 333 ms,
/// PTO about 1 s, backoff to about 3 s) is treated as an unreachable endpoint.
pub const unanswered_dial_timeout_ms: u64 = 3_000;
pub const recv_udp_payload_max: u64 = 1_452;
pub const send_udp_payload_max: u64 = 1_200;
pub const amplification_factor_max: usize = 3;
pub const initial_congestion_window_packets: usize = 10;
pub const ack_delay_exponent: u64 = 3;
pub const ack_delay_max_ms: u64 = 25;
pub const client_initial_min: usize = 1_200;
pub const receive_budget_bytes: u64 = 512 * 1_024 * 1_024;
pub const connection_window_min: u64 = 1 * 1_024 * 1_024;
pub const connection_window_max: u64 = 16 * 1_024 * 1_024;
pub const timeout_ms_max: u64 = 24 * 60 * 60 * 1000;
pub const local_cid_length: usize = 16;
pub const initial_dcid_length_min: usize = 8;
pub const cid_length_max: usize = 20;
pub const path_events_per_call_max: u8 = 8;

comptime {
    std.debug.assert(initial_dcid_length_min <= local_cid_length);
    std.debug.assert(local_cid_length <= cid_length_max);
    std.debug.assert(client_initial_min <= recv_udp_payload_max);
    std.debug.assert(client_initial_min <= send_udp_payload_max);
    std.debug.assert(send_udp_payload_max <= recv_udp_payload_max);
    std.debug.assert(recv_udp_payload_max <= constants.datagram_size_max);
    std.debug.assert(connection_window_min <= connection_window_max);
    std.debug.assert(unanswered_dial_timeout_ms <= handshake_timeout_ms);
    std.debug.assert(handshaking_max <= connections_max_default);
    std.debug.assert(dialing_max <= connections_max_default - handshaking_max);
    std.debug.assert(connections_max_default <= connections_max_ceiling);
    std.debug.assert(streams_per_connection == 2 * peer_streams_bidi);
    std.debug.assert(receive_budget_bytes / connections_max_default >= connection_window_min);
    std.debug.assert(receive_budget_bytes / connections_max_default <= connection_window_max);
}

/// Engine events delivered per turn. A connection whose events do not fit keeps the rest for the next turn.
pub const events_per_turn_max: usize = 1_024;
/// Largest send watermark armed after a blocked write: quiche's minimum congestion window of two
/// datagrams. A blocked stream with nothing in flight never sees more send capacity than that.
pub const write_lowat_max: u32 = 2 * send_udp_payload_max;
