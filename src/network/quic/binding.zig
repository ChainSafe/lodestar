const std = @import("std");
const limits = @import("limits.zig");
const types = @import("../types.zig");

// The pinned quiche FFI exports zero timestamps on macOS, iOS, and Windows.
// Linux uses CLOCK_MONOTONIC, the same clock as std.Io.Clock.awake.
pub const native_pacing_supported = @import("builtin").os.tag == .linux;

pub const c = @import("quiche_zig:quiche");

pub const Error = error{
    BufferTooShort,
    UnknownVersion,
    InvalidFrame,
    InvalidPacket,
    InvalidState,
    InvalidStreamState,
    InvalidTransportParam,
    CryptoFail,
    TlsFail,
    FlowControl,
    StreamLimit,
    StreamStopped,
    StreamReset,
    FinalSize,
    CongestionControl,
    IdLimit,
    OutOfIdentifiers,
    KeyUpdate,
    CryptoBufferExceeded,
    InvalidAckRange,
    OptimisticAckDetected,
    InvalidDcidInitialization,
    Unknown,
};

pub fn check(rc: anytype) Error!?usize {
    const value: isize = @intCast(rc);
    if (value >= 0) return @intCast(value);
    if (value == c.QUICHE_ERR_DONE) return null;
    return switch (value) {
        c.QUICHE_ERR_BUFFER_TOO_SHORT => error.BufferTooShort,
        c.QUICHE_ERR_UNKNOWN_VERSION => error.UnknownVersion,
        c.QUICHE_ERR_INVALID_FRAME => error.InvalidFrame,
        c.QUICHE_ERR_INVALID_PACKET => error.InvalidPacket,
        c.QUICHE_ERR_INVALID_STATE => error.InvalidState,
        c.QUICHE_ERR_INVALID_STREAM_STATE => error.InvalidStreamState,
        c.QUICHE_ERR_INVALID_TRANSPORT_PARAM => error.InvalidTransportParam,
        c.QUICHE_ERR_CRYPTO_FAIL => error.CryptoFail,
        c.QUICHE_ERR_TLS_FAIL => error.TlsFail,
        c.QUICHE_ERR_FLOW_CONTROL => error.FlowControl,
        c.QUICHE_ERR_STREAM_LIMIT => error.StreamLimit,
        c.QUICHE_ERR_STREAM_STOPPED => error.StreamStopped,
        c.QUICHE_ERR_STREAM_RESET => error.StreamReset,
        c.QUICHE_ERR_FINAL_SIZE => error.FinalSize,
        c.QUICHE_ERR_CONGESTION_CONTROL => error.CongestionControl,
        c.QUICHE_ERR_ID_LIMIT => error.IdLimit,
        c.QUICHE_ERR_OUT_OF_IDENTIFIERS => error.OutOfIdentifiers,
        c.QUICHE_ERR_KEY_UPDATE => error.KeyUpdate,
        c.QUICHE_ERR_CRYPTO_BUFFER_EXCEEDED => error.CryptoBufferExceeded,
        c.QUICHE_ERR_INVALID_ACK_RANGE => error.InvalidAckRange,
        c.QUICHE_ERR_OPTIMISTIC_ACK_DETECTED => error.OptimisticAckDetected,
        c.QUICHE_ERR_INVALID_DCID_INITIALIZATION => error.InvalidDcidInitialization,
        else => error.Unknown,
    };
}

pub const Config = struct {
    ptr: *c.quiche_config,

    pub fn init(idle_timeout_ms: u64, connection_window: u64, stream_window: u64, initial_congestion_window_packets: u16) Error!Config {
        const ptr = c.quiche_config_new(c.QUICHE_PROTOCOL_VERSION) orelse return error.Unknown;
        c.quiche_config_set_max_idle_timeout(ptr, idle_timeout_ms);
        c.quiche_config_set_max_recv_udp_payload_size(ptr, limits.recv_udp_payload_max);
        c.quiche_config_set_initial_max_data(ptr, connection_window);
        c.quiche_config_set_initial_max_stream_data_bidi_local(ptr, stream_window);
        c.quiche_config_set_initial_max_stream_data_bidi_remote(ptr, stream_window);
        c.quiche_config_set_initial_max_stream_data_uni(ptr, 0);
        c.quiche_config_set_initial_max_streams_bidi(ptr, limits.peer_streams_bidi);
        c.quiche_config_set_initial_max_streams_uni(ptr, 0);
        c.quiche_config_set_max_connection_window(ptr, connection_window);
        c.quiche_config_set_max_stream_window(ptr, stream_window);
        c.quiche_config_set_active_connection_id_limit(ptr, 2);
        c.quiche_config_set_disable_active_migration(ptr, true);
        c.quiche_config_set_disable_dcid_reuse(ptr, false);
        c.quiche_config_set_cc_algorithm(ptr, c.QUICHE_CC_CUBIC);
        c.quiche_config_enable_hystart(ptr, true);
        c.quiche_config_enable_pacing(ptr, native_pacing_supported);
        c.quiche_config_set_initial_congestion_window_packets(
            ptr,
            initial_congestion_window_packets,
        );
        c.quiche_config_set_max_send_udp_payload_size(ptr, limits.send_udp_payload_max);
        c.quiche_config_discover_pmtu(ptr, false);
        c.quiche_config_set_max_amplification_factor(ptr, limits.amplification_factor_max);
        c.quiche_config_set_ack_delay_exponent(ptr, limits.ack_delay_exponent);
        c.quiche_config_set_max_ack_delay(ptr, limits.ack_delay_max_ms);
        c.quiche_config_enable_dgram(ptr, false, 0, 0);
        c.quiche_config_grease(ptr, true);
        return .{ .ptr = ptr };
    }

    pub fn deinit(self: *Config) void {
        c.quiche_config_free(self.ptr);
        self.* = undefined;
    }
};

pub const SockAddr = struct {
    storage: Storage,
    len: std.posix.socklen_t,

    const Storage = extern union {
        any: std.posix.sockaddr,
        in: std.posix.sockaddr.in,
        in6: std.posix.sockaddr.in6,
    };

    pub const unspecified: SockAddr = fromAddress(types.Address.unspecified);

    pub fn fromAddress(address: types.Address) SockAddr {
        return switch (address) {
            .ip4 => |ip| .{
                .storage = .{ .in = .{
                    .port = std.mem.nativeToBig(u16, ip.port),
                    .addr = @bitCast(ip.octets),
                } },
                .len = @sizeOf(std.posix.sockaddr.in),
            },
            .ip6 => |ip| .{
                .storage = .{ .in6 = .{
                    .port = std.mem.nativeToBig(u16, ip.port),
                    .flowinfo = 0,
                    .addr = ip.octets,
                    .scope_id = ip.interface,
                } },
                .len = @sizeOf(std.posix.sockaddr.in6),
            },
        };
    }

    pub fn any(self: *const SockAddr) *const std.posix.sockaddr {
        return &self.storage.any;
    }

    pub fn fromStorage(
        storage: *const c.struct_sockaddr_storage,
        len: std.posix.socklen_t,
    ) ?SockAddr {
        if (len == 0 or len > @sizeOf(Storage)) return null;
        var result = SockAddr{ .storage = undefined, .len = len };
        @memcpy(std.mem.asBytes(&result.storage)[0..len], std.mem.asBytes(storage)[0..len]);
        return result;
    }

    pub fn toAddress(self: *const SockAddr) ?types.Address {
        std.debug.assert(self.len <= @sizeOf(Storage));
        switch (self.storage.any.family) {
            std.posix.AF.INET => {
                if (self.len < @sizeOf(std.posix.sockaddr.in)) return null;
                const in = self.storage.in;
                return .{ .ip4 = .{
                    .octets = @bitCast(in.addr),
                    .port = std.mem.bigToNative(u16, in.port),
                } };
            },
            std.posix.AF.INET6 => {
                if (self.len < @sizeOf(std.posix.sockaddr.in6)) return null;
                const in6 = self.storage.in6;
                const port = std.mem.bigToNative(u16, in6.port);
                return types.Address.fromNetwork(.{ .ip6 = .{
                    .bytes = in6.addr,
                    .port = port,
                    .interface = .{ .index = in6.scope_id },
                } });
            },
            else => return null,
        }
    }
};

pub const Cid = struct {
    bytes: [limits.cid_length_max]u8 = undefined,
    len: u8 = 0,

    pub fn fromSlice(bytes: []const u8) Cid {
        std.debug.assert(bytes.len <= limits.cid_length_max);
        var cid = Cid{ .len = @intCast(bytes.len) };
        @memcpy(cid.bytes[0..bytes.len], bytes);
        return cid;
    }

    pub fn slice(self: *const Cid) []const u8 {
        return self.bytes[0..self.len];
    }

    pub fn eql(self: *const Cid, other: *const Cid) bool {
        return std.mem.eql(u8, self.slice(), other.slice());
    }
};

pub const Header = struct {
    version: u32,
    packet_type: Type,
    scid: Cid,
    dcid: Cid,
    /// Borrows the token storage passed to `parse`.
    token: []const u8,

    pub const Type = enum(u8) {
        initial = 1,
        retry = 2,
        handshake = 3,
        zero_rtt = 4,
        short = 5,
        version_negotiation = 6,
        _,
    };

    pub const token_max = @import("../constants.zig").datagram_size_max;

    /// Writes the packet's token into `token`, which the result borrows.
    pub fn parse(datagram: []const u8, token: *[token_max]u8) Error!Header {
        var version: u32 = 0;
        var packet_type: u8 = 0;
        var scid: [limits.cid_length_max]u8 = undefined;
        var scid_len: usize = scid.len;
        var dcid: [limits.cid_length_max]u8 = undefined;
        var dcid_len: usize = dcid.len;
        var token_len: usize = token.len;
        const written = try check(c.quiche_header_info(
            datagram.ptr,
            datagram.len,
            limits.local_cid_length,
            &version,
            &packet_type,
            &scid,
            &scid_len,
            &dcid,
            &dcid_len,
            token,
            &token_len,
        ));
        if (written == null) return error.InvalidPacket;
        std.debug.assert(scid_len <= scid.len);
        std.debug.assert(dcid_len <= dcid.len);
        std.debug.assert(token_len <= token.len);
        return .{
            .version = version,
            .packet_type = @enumFromInt(packet_type),
            .scid = Cid.fromSlice(scid[0..scid_len]),
            .dcid = Cid.fromSlice(dcid[0..dcid_len]),
            .token = token[0..token_len],
        };
    }
};

/// quiche's `quiche_send_info`. translate-c makes the C struct opaque for musl, whose
/// `struct timespec` pads with bitfields, so this layout is checked against the C compiler's.
pub const SendInfo = extern struct {
    from: c.struct_sockaddr_storage,
    from_len: c.socklen_t,
    to: c.struct_sockaddr_storage,
    to_len: c.socklen_t,
    at: std.c.timespec,

    /// quiche's release time for a datagram. Under CUBIC it is the send time, so a datagram is
    /// never held; the transport asserts that in debug builds.
    pub fn transmitDeadline(self: *const SendInfo) u64 {
        std.debug.assert(self.at.sec >= 0);
        std.debug.assert(self.at.nsec >= 0 and self.at.nsec < std.time.ns_per_s);
        const seconds: u64 = @intCast(self.at.sec);
        return seconds *| std.time.ns_per_s +| @as(u64, @intCast(self.at.nsec));
    }
};

comptime {
    const layout = @import("quiche_send_info_layout");
    std.debug.assert(@sizeOf(SendInfo) == layout.send_info_size);
    std.debug.assert(@alignOf(SendInfo) == layout.send_info_align);
    std.debug.assert(@offsetOf(SendInfo, "from") == layout.send_info_from);
    std.debug.assert(@offsetOf(SendInfo, "from_len") == layout.send_info_from_len);
    std.debug.assert(@offsetOf(SendInfo, "to") == layout.send_info_to);
    std.debug.assert(@offsetOf(SendInfo, "to_len") == layout.send_info_to_len);
    std.debug.assert(@offsetOf(SendInfo, "at") == layout.send_info_at);
    std.debug.assert(@sizeOf(@FieldType(SendInfo, "at")) == layout.send_info_at_size);
    std.debug.assert(@offsetOf(@FieldType(SendInfo, "at"), "nsec") == layout.send_info_at_nsec);
}

pub fn connSend(conn: *c.quiche_conn, out: []u8, info: *SendInfo) isize {
    return c.quiche_conn_send(conn, out.ptr, out.len, @ptrCast(info));
}

test {
    _ = @import("binding_test.zig");
}
