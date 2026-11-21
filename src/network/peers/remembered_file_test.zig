const std = @import("std");
const file = @import("remembered_file.zig");
const remembered = @import("remembered.zig");
const keys = @import("../wire/keys.zig");
const peer_id = @import("../wire/peer_id.zig");
const root: [32]u8 = @splat(7);

fn record(tag: u8) !remembered.Record {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{tag}));
    return .{ .peer = peer_id.PeerId.fromPublicKey(&key.publicKey()), .address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, tag }, .port = 9000 } }, .qualified_at_s = 12345 };
}

test "remembered file round trips both address families and maximum record count" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var records: [remembered.capacity]remembered.Record = @splat(try record(1));
    records[1].address = .{ .ip6 = .{ .octets = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1}, .port = 9001 } };
    records[1].qualified_at_s = std.math.maxInt(u64);
    try file.write(std.testing.io, temporary.dir, &root, &records);
    var out: [remembered.capacity]remembered.Record = undefined;
    const loaded = try file.read(std.testing.io, temporary.dir, &root, &out);
    try std.testing.expectEqual(remembered.capacity, loaded.count);
    try std.testing.expectEqual(0, loaded.skipped);
    try std.testing.expectEqualDeep(records, out);
}

test "remembered file skips malformed lines and rejects foreign or unsupported headers" {
    var text: [4096]u8 = undefined;
    var writer: std.Io.Writer = .fixed(&text);
    const records = [_]remembered.Record{try record(1)};
    try file.encode(&writer, &root, &records);
    const line = writer.buffered()[std.mem.findScalar(u8, writer.buffered(), '\n').? + 1 ..];
    try writer.writeAll("broken\n");
    try writer.splatByteAll('x', file.line_max + 1);
    try writer.writeAll("\n");
    var identity: [peer_id.text_length_max]u8 = undefined;
    const invalid = [_][]const u8{
        "::ffff:127.0.0.1 9000 12345",         "0.0.0.0 9000 12345",         "127.0.0.1 0 12345",
        "localhost 9000 12345",                "127.0.0.1 65536 12345",      "127.0.0.1 9000 -1",
        "127.0.0.1 9000 18446744073709551616", "127.0.0.1 9000 12345 extra",
    };
    for (invalid) |fields| try writer.print("{s} {s}\n", .{ records[0].peer.toText(&identity), fields });
    try writer.writeAll(line);
    var out: [remembered.capacity]remembered.Record = undefined;
    const loaded = try file.decode(writer.buffered(), &root, &out);
    try std.testing.expectEqual(2, loaded.count);
    try std.testing.expectEqual(2 + invalid.len, loaded.skipped);
    try std.testing.expectEqualDeep(records[0], out[1]);
    try std.testing.expectError(error.WrongNetwork, file.decode(writer.buffered(), &@as([32]u8, @splat(8)), &out));
    try std.testing.expectError(error.InvalidHeader, file.decode("lodestar-peers-v2 00\n", &root, &out));
    try std.testing.expectError(error.InvalidHeader, file.decode("", &root, &out));
}

test "remembered file bounds bytes and records and rejects non-regular files" {
    var out: [remembered.capacity]remembered.Record = undefined;
    const oversized = try std.testing.allocator.alloc(u8, file.bytes_max + 1);
    defer std.testing.allocator.free(oversized);
    @memset(oversized, 'x');
    try std.testing.expectError(error.FileTooLarge, file.decode(oversized, &root, &out));
    var writer: std.Io.Writer = .fixed(oversized);
    const records: [remembered.capacity]remembered.Record = @splat(try record(1));
    try file.encode(&writer, &root, &records);
    const line = writer.buffered()[std.mem.findScalar(u8, writer.buffered(), '\n').? + 1 ..];
    try writer.writeAll(line[0 .. std.mem.findScalar(u8, line, '\n').? + 1]);
    try std.testing.expectError(error.TooManyRecords, file.decode(writer.buffered(), &root, &out));
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    try std.testing.expectError(error.FileNotFound, file.read(std.testing.io, temporary.dir, &root, &out));
    try temporary.dir.createDir(std.testing.io, file.name, .default_dir);
    try std.testing.expectError(error.NotRegularFile, file.read(std.testing.io, temporary.dir, &root, &out));
}

test "remembered file decoder handles bounded arbitrary input" {
    var random = std.Random.DefaultPrng.init(29);
    var bytes: [1024]u8 = undefined;
    var out: [remembered.capacity]remembered.Record = undefined;
    var writer: std.Io.Writer = .fixed(&bytes);
    try file.encode(&writer, &root, &.{});
    const start = writer.end;
    for (0..512) |_| {
        random.random().bytes(bytes[start..]);
        const len = start + random.random().uintLessThan(usize, bytes.len - start + 1);
        _ = file.decode(bytes[0..len], &root, &out) catch {};
    }
}
