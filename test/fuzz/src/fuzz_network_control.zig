const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const d = @import("discv5");
const peers = @import("network").peers;
const wire = @import("network").control_wire;
const context: peers.ForkContext = .{ .digest = .{ 1, 2, 3, 4 } };
const input_max = 302;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    const bytes = input[1..len];
    switch (input[0] % 7) {
        0 => {
            const record = d.identity.enr.Record.init(bytes) catch return;
            decodeRecord(&record);
        },
        1, 2 => {
            const protocol: wire.Protocol = if (input[0] % 7 == 1) .status_v1 else .status_v2;
            const value = wire.decodeStatus(protocol, bytes) catch return;
            var encoded: [92]u8 = undefined;
            const length = wire.encodeStatus(protocol, &value, &encoded) catch unreachable;
            std.debug.assert(std.mem.eql(u8, bytes, encoded[0..length]));
        },
        3, 4, 5 => {
            const protocol: wire.Protocol = switch (input[0] % 7) {
                3 => .metadata_v1,
                4 => .metadata_v2,
                else => .metadata_v3,
            };
            var fork = context;
            fork.fork = if (protocol == .metadata_v3) .fulu else if (protocol == .metadata_v2) .altair else .phase0;
            const value = wire.decodeMetadata(protocol, bytes, fork) catch return;
            var encoded: [25]u8 = undefined;
            // Decoding accepts a remote custody group count of zero, which the spec lets clients
            // keep ("MAY reject" below CUSTODY_REQUIREMENT) and which earns no custody credit;
            // encoding refuses it because local metadata never advertises zero.
            if (value.custody_group_count == 0) {
                if (wire.encodeMetadata(protocol, &value, fork, &encoded)) |_| unreachable else |err| std.debug.assert(err == error.InvalidCustodyCount);
                return;
            }
            const length = wire.encodeMetadata(protocol, &value, fork, &encoded) catch unreachable;
            std.debug.assert(std.mem.eql(u8, bytes, encoded[0..length]));
        },
        6 => signedFields(bytes),
        else => unreachable,
    }
}

fn decodeRecord(record: *const d.identity.enr.Record) void {
    const candidate = peers.enr.decode(record, &context) catch return;
    std.debug.assert(candidate.address_count <= 2);
    std.debug.assert(candidate.hints.custody_group_count == null or candidate.hints.custody_group_count.? <= context.custody_groups);
}

fn signedFields(bytes: []const u8) void {
    if (bytes.len == 0 or bytes.len > 64) return;
    const value = bytes[1..];
    const key = d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1})) catch unreachable;
    const public = d.identity.crypto.compressedPublicKey(&key);
    const fork = [_]u8{ 1, 2, 3, 4 } ++ .{0} ** 4 ++ .{255} ** 8;
    var fields = [_]d.identity.enr.Field{
        .{ .key = "attnets", .value = .{ .bytes = &(.{0} ** 8) } },
        .{ .key = "cgc", .value = .{ .uint = 4 } },
        .{ .key = "eth2", .value = .{ .bytes = &fork } },
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &.{ 127, 0, 0, 1 } } },
        .{ .key = "nfd", .value = .{ .bytes = &.{ 0, 0, 0, 0 } } },
        .{ .key = "quic", .value = .{ .uint = 9001 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public } },
        .{ .key = "syncnets", .value = .{ .bytes = &.{5} } },
    };
    const selected = [_]usize{ 0, 1, 2, 5, 6, 8 };
    fields[selected[bytes[0] % selected.len]].value = .{ .bytes = value };
    const record = d.identity.enr.Record.createFields(&key, 1, &fields) catch return;
    decodeRecord(&record);
}
