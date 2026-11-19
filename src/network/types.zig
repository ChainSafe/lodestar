const ForkSeq = @import("config").ForkSeq;
pub const ForkEntry = struct {
    digest: [4]u8,
    fork: ForkSeq,
};

pub const Address = @import("udp").Address;
pub const Schedule = @import("schedule.zig").Schedule;
pub const Handle = struct {
    index: u16,
    generation: u32,
};

/// Captured with the observed work, never reconstructed from a later identity lookup.
/// A null endpoint means the transport cannot attribute the work to one source path.
pub const PeerOrigin = struct {
    connection: Handle,
    endpoint: ?Address,
};

pub const StreamHandle = struct {
    conn: Handle,
    id: u64,
    slot: u8,
};

/// Stream readiness reported by the engine. Each bit is an edge: it is set again only after the
/// stream's state changes in QUIC.
pub const Readiness = packed struct(u2) { readable: bool = false, writable: bool = false };

/// The protocol owner that holds a stream. The engine stores it and never interprets it.
pub const StreamOwner = enum(u8) { none, negotiation, identify, reqresp_outbound, reqresp_inbound, reqresp_control_outbound, reqresp_control_inbound, gossip_inbound, gossip_outbound };
/// Where a stream's events go: the owner and the row in the owner's own table.
pub const Route = packed struct(u32) { owner: StreamOwner = .none, row: u24 = 0 };

pub const PeerRef = struct { index: u16, generation: u64 };

pub const Direction = enum { inbound, outbound };
pub const ShutdownDirection = enum { read, write };

pub const Now = @import("time.zig").Now;

pub const CloseReason = union(enum) {
    host,
    idle_timeout,
    handshake_timeout,
    dial_unanswered,
    peer_id_mismatch,
    tls_failed,
    peer_closed: struct { app: bool, code: u64 },
    transport_error: u64,
    send_failed,
};

pub const Sent = struct {
    bytes: []u8,
    to: Address,
    transmit_at_ns: u64 = 0,
};

pub const PendingClose = struct { reason: CloseReason, code: u64 };

pub const Read = struct {
    len: usize,
    fin: bool,
    reset_code: ?u64 = null,
};

pub const app_error_normal: u64 = 0;
pub const app_error_peer_id_mismatch: u64 = 1;
pub const app_error_handshake_timeout: u64 = 2;
pub const app_error_stream_table_full: u64 = 3;
pub const app_error_negotiation_failed: u64 = 4;

pub const crypto_error_first: u64 = 0x100;
pub const crypto_error_last: u64 = 0x1ff;

pub fn reasonFromLocalError(is_app: bool, code: u64) CloseReason {
    if (!is_app and code >= crypto_error_first and code <= crypto_error_last) return .tls_failed;
    return .{ .transport_error = code };
}

test {
    _ = @import("types_test.zig");
}
