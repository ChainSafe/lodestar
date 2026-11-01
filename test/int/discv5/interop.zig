const std = @import("std");
const discv5 = @import("discv5");
const Sockets = @import("udp").Sockets;

const duration_ms: u64 = 8_000;
const steps_max: usize = 512;
const call_capacity: usize = 4;
const Phase = enum { waiting, ping, ping_complete, nodes, done };

pub fn main(init: std.process.Init) !void {
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer std.debug.assert(gpa.deinit() == .ok);
    const allocator = gpa.allocator();
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 3) return error.ExpectedModeAndGethRecord;
    const unadvertised = std.mem.eql(u8, args[1], "zig-unadvertised");
    const zig_first = unadvertised or std.mem.eql(u8, args[1], "zig-first");
    if (!zig_first and !std.mem.eql(u8, args[1], "geth-first")) return error.InvalidMode;
    const remote = try discv5.identity.enr.Record.initText(args[2]);
    const address = remote.endpoint() orelse return error.MissingEndpoint;
    if (address != .ip4 or address.ip4.octets[0] != 127) return error.NonLoopbackEndpoint;
    const peer = discv5.types.Endpoint{ .node_id = remote.node_id, .address = address };

    var sockets = try Sockets.bind(io, .{ .ip4 = .loopback(0) });
    var sockets_owned = true;
    errdefer if (sockets_owned) sockets.close(io);
    var key = try discv5.identity.crypto.keyPairFromSecret(&([_]u8{0x11} ** 32));
    defer std.crypto.secureZero(u8, std.mem.asBytes(&key));
    const public_key = discv5.identity.crypto.compressedPublicKey(&key);
    const local = if (unadvertised) try discv5.identity.enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
    }) else try discv5.identity.enr.Record.create(&key, 1, discv5.types.Address.fromNetwork(sockets.primary().address));
    var driver: discv5.Transport = undefined;
    try driver.init(allocator, sockets, key, local, .{
        .session_capacity = 4,
        .challenge_capacity = 4,
        .call_capacity = call_capacity,
        .request_timeout_ms = 2_000,
        .challenge_timeout_ms = 2_000,
        .session_idle_timeout_ms = 60_000,
    });
    sockets_owned = false;
    defer driver.deinit(allocator, io);
    try printRecord(io, &local);

    const deadline_ms = (try discv5.Transport.monotonicMilliseconds(io)) + duration_ms;
    var phase: Phase = .waiting;
    var pending: ?discv5.CallTable.Handle = null;
    defer if (pending) |handle| {
        _ = driver.engine.cancelCall(handle);
    };
    var served: usize = 0;
    var expired: [call_capacity]discv5.CallTable.Expired = undefined;
    for (0..steps_max) |_| {
        if (try discv5.Transport.monotonicMilliseconds(io) >= deadline_ms)
            return error.InteropTimedOut;
        if (phase == .waiting and (zig_first or served >= 2)) {
            const ping = discv5.wire.message.Message{ .ping = .{
                .request_id = try discv5.wire.message.RequestId.init(&.{1}),
                .enr_sequence = local.sequence,
            } };
            pending = try driver.startCall(io, peer, &remote, &ping, try discv5.Transport.monotonicMilliseconds(io));
            phase = .ping;
        } else if (phase == .ping_complete) {
            const find_node = discv5.wire.message.Message{ .find_node = .{
                .request_id = try discv5.wire.message.RequestId.init(&.{2}),
                .distances = &.{0},
            } };
            pending = try driver.startCall(io, peer, &remote, &find_node, try discv5.Transport.monotonicMilliseconds(io));
            phase = .nodes;
        } else if (phase == .done and (unadvertised or served >= 2)) {
            try std.Io.File.stdout().writeStreamingAll(io, "DONE\n");
            return;
        }

        const result = try discv5.driver.step(&driver, io, &expired, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, deadline_ms) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        served += result.standard_responses;
        var call_expired = false;
        for (expired[0..result.calls_expired]) |entry| {
            if (pending) |handle| if (std.meta.eql(handle, entry.handle)) {
                pending = null;
                call_expired = true;
            };
        }
        var call_failure: ?discv5.Engine.Error = null;
        switch (result.event) {
            .response => |response| {
                const handle = pending orelse return error.UnexpectedResponse;
                if (!std.meta.eql(handle, response.matched.handle) or
                    !std.meta.eql(peer, response.peer) or !response.matched.terminal)
                    return error.UnexpectedResponse;
                switch (phase) {
                    .ping => {
                        if (response.matched.response != .pong) return error.ExpectedPong;
                        const pong = response.matched.response.pong;
                        if (pong.enr_sequence != remote.sequence or
                            pong.recipient_port != driver.localAddress().port() or
                            pong.recipient_ip != .ip4 or
                            !std.mem.eql(u8, &pong.recipient_ip.ip4, &.{ 127, 0, 0, 1 }))
                            return error.InvalidPong;
                        phase = .ping_complete;
                        try std.Io.File.stdout().writeStreamingAll(io, "ZIG_PONG\n");
                    },
                    .nodes => {
                        if (response.matched.response != .nodes or response.node_records.len != 1)
                            return error.ExpectedSelfRecord;
                        if (!std.mem.eql(u8, response.node_records[0].slice(), remote.slice()))
                            return error.InvalidSelfRecord;
                        phase = .done;
                        try std.Io.File.stdout().writeStreamingAll(io, "ZIG_ENR\n");
                    },
                    else => return error.UnexpectedResponse,
                }
                pending = null;
            },
            .failed => |failure| {
                pending = null;
                call_failure = failure.reason;
            },
            .none => {},
            .request => return error.UnexpectedRequest,
        }
        if (result.failure) |failure| return failure.cause;
        if (call_failure) |failure| return failure;
        if (call_expired) return error.RequestTimedOut;
        if (result.datagram == .rejected) {
            std.debug.print("rejected {s}\n", .{@tagName(result.datagram.rejected)});
            return error.RejectedDatagram;
        }
    }
    return error.StepBudgetExhausted;
}

fn printRecord(io: std.Io, record: *const discv5.identity.enr.Record) !void {
    var encoded_buffer: [512]u8 = undefined;
    const encoded = std.base64.url_safe_no_pad.Encoder.encode(&encoded_buffer, record.slice());
    var line_buffer: [528]u8 = undefined;
    const line = try std.fmt.bufPrint(&line_buffer, "ENR enr:{s}\n", .{encoded});
    try std.Io.File.stdout().writeStreamingAll(io, line);
}
