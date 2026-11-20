const config = @import("config");
const codec = @import("codec.zig");
const constants = @import("constants.zig");
const Negotiator = @import("../negotiate.zig").Negotiator;
const types = @import("../types.zig");
const Handle = types.Handle;
const Protocol = @import("protocol.zig").Protocol;
const PeerId = @import("../wire/peer_id.zig").PeerId;

pub const RequestPhase = enum { negotiation, request, response };

pub const RequestHandle = struct {
    index: u16,
    generation: u32,
    direction: types.Direction,
};

pub const Failure = union(enum) {
    timeout,
    host_timeout,
    quota_timeout,
    cancelled,
    negotiation_rejected,
    negotiation_failed: Negotiator.Failure,
    invalid_response: (codec.Error || error{InvalidResponseContext}),
    too_many_chunks,
    empty_response,
    unknown_context: [constants.context_bytes_length]u8,
    peer_error: struct { code: u8, message_len: u16 },
    connection_closed,
    stream_closed,
    transport,
};

pub const PeerFault = struct {
    identity: PeerId,
    origin: types.PeerOrigin,
    kind: Kind,

    pub const Kind = enum { protocol, non_completion };
};

pub const Event = union(enum) {
    /// Borrows the caller's sink until consume or terminal delivery.
    chunk: struct { request: RequestHandle, bytes: []const u8, fork: ?config.ForkSeq, origin: types.PeerOrigin },
    done: struct { request: RequestHandle, chunks: u32 },
    failed: Failed,
    /// Borrows receive bytes until served/failed delivery, regardless of retained host execution.
    request: struct { request: RequestHandle, conn: Handle, protocol: Protocol, bytes: []const u8 },
    /// Releases the response bytes passed to respond.
    chunk_sent: struct { request: RequestHandle, chunks: u32 },
    served: struct { request: RequestHandle, chunks: u32, peer_fault: ?PeerFault = null },

    pub const Failed = struct {
        request: RequestHandle,
        reason: Failure,
        phase: ?RequestPhase = null,
        origin: ?types.PeerOrigin = null,
        peer_fault: ?PeerFault = null,
        message: [codec.error_message_max]u8 = @splat(0),

        pub fn errorMessage(self: *const Failed) []const u8 {
            return if (self.reason == .peer_error) self.message[0..self.reason.peer_error.message_len] else &.{};
        }
    };

    pub fn peerFault(self: *const Event) ?*const PeerFault {
        return switch (self.*) {
            .failed => |*e| if (e.peer_fault) |*fault| fault else null,
            .served => |*e| if (e.peer_fault) |*fault| fault else null,
            else => null,
        };
    }
};
