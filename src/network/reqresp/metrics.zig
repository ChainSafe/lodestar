const std = @import("std");
const Histogram = @import("../metrics/histogram.zig").Duration;
const rr = @import("events.zig");

pub const OutgoingTime = Histogram(&.{ 100, 200, 500, 1000, 5000, 10000, 15000, 60000 });
pub const IncomingTime = Histogram(&.{ 100, 200, 500, 1000, 5000, 10000 });
pub const ErrorReason = enum {
    REQUEST_ERROR_DIAL_ERROR,
    REQUEST_ERROR_DIAL_TIMEOUT,
    REQUEST_ERROR_REQUEST_TIMEOUT,
    REQUEST_ERROR_RESP_TIMEOUT,
    REQUEST_ERROR_INVALID_RESPONSE_SSZ,
    REQUEST_ERROR_INVALID_REQUEST,
    REQUEST_ERROR_SERVER_ERROR,
    RESOURCE_UNAVAILABLE_ERROR,
    REQUEST_ERROR_UNKNOWN_ERROR_STATUS,
    REQUEST_ERROR_REQUEST_ERROR,
    REQUEST_ERROR_EMPTY_RESPONSE,

    pub fn fromFailure(reason: rr.Failure, phase: rr.RequestPhase) ErrorReason {
        return switch (reason) {
            .timeout => switch (phase) {
                .negotiation => .REQUEST_ERROR_DIAL_TIMEOUT,
                .request => .REQUEST_ERROR_REQUEST_TIMEOUT,
                .response => .REQUEST_ERROR_RESP_TIMEOUT,
            },
            .negotiation_failed => |failure| if (failure == .timeout) .REQUEST_ERROR_DIAL_TIMEOUT else .REQUEST_ERROR_DIAL_ERROR,
            .negotiation_rejected => .REQUEST_ERROR_DIAL_ERROR,
            .invalid_response, .too_many_chunks, .unknown_context => .REQUEST_ERROR_INVALID_RESPONSE_SSZ,
            .empty_response => .REQUEST_ERROR_EMPTY_RESPONSE,
            .peer_error => |err| switch (err.code) {
                1 => .REQUEST_ERROR_INVALID_REQUEST,
                2 => .REQUEST_ERROR_SERVER_ERROR,
                3 => .RESOURCE_UNAVAILABLE_ERROR,
                else => .REQUEST_ERROR_UNKNOWN_ERROR_STATUS,
            },
            else => .REQUEST_ERROR_REQUEST_ERROR,
        };
    }
};
pub const error_reason_count = @typeInfo(ErrorReason).@"enum".fields.len;

pub const AdmissionRefusal = enum {
    connection_capacity,
    protocol_concurrency,
    peer_quota,
    address_quota,
    global_quota,
};
pub const admission_refusal_count = @typeInfo(AdmissionRefusal).@"enum".fields.len;

pub const InboundPhase = enum { receiving_request, waiting_start, ready, waiting_host, writing_response, terminal };
pub const inbound_phase_count = @typeInfo(InboundPhase).@"enum".fields.len;

pub const ProtocolCounters = struct {
    outgoing: u64 = 0,
    outgoing_opened: u64 = 0,
    outgoing_closed: u64 = 0,
    incoming: u64 = 0,
    outgoing_errors: u64 = 0,
    incoming_errors: u64 = 0,
    admission_refusals: [admission_refusal_count]u64 = @splat(0),
    outgoing_time: OutgoingTime = .{},
    incoming_time: IncomingTime = .{},
};

test "request error labels match host timeout phases and response status mapping" {
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_DIAL_ERROR, ErrorReason.fromFailure(.negotiation_rejected, .negotiation));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_DIAL_ERROR, ErrorReason.fromFailure(.{ .negotiation_failed = .malformed }, .negotiation));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_DIAL_TIMEOUT, ErrorReason.fromFailure(.timeout, .negotiation));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_DIAL_TIMEOUT, ErrorReason.fromFailure(.{ .negotiation_failed = .timeout }, .negotiation));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_REQUEST_TIMEOUT, ErrorReason.fromFailure(.timeout, .request));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_RESP_TIMEOUT, ErrorReason.fromFailure(.timeout, .response));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_SERVER_ERROR, ErrorReason.fromFailure(.{ .peer_error = .{ .code = 2, .message_len = 0 } }, .response));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_UNKNOWN_ERROR_STATUS, ErrorReason.fromFailure(.{ .peer_error = .{ .code = 255, .message_len = 0 } }, .response));
    try std.testing.expectEqual(ErrorReason.REQUEST_ERROR_EMPTY_RESPONSE, ErrorReason.fromFailure(.empty_response, .response));
}
