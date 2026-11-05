//! Versioned, line-oriented peer cache. The directory belongs to the trusted local caller.
const std = @import("std");
const remembered = @import("remembered.zig");
const t = @import("types.zig");
const peer_id = @import("../wire/peer_id.zig");

pub const name = "native-remembered-peers.txt";
pub const bytes_max = 128 * 1024;
pub const line_max = 256;
const header = "lodestar-peers-v1";
pub const DecodeError = error{ FileTooLarge, InvalidHeader, WrongNetwork, TooManyRecords };
pub const ReadError = DecodeError || std.Io.Dir.StatFileError || std.Io.Dir.ReadFileError || error{NotRegularFile};
pub const WriteError = std.Io.Dir.CreateFileAtomicError || std.Io.File.Writer.Error || std.Io.File.Atomic.ReplaceError;
pub const Loaded = struct { count: u16 = 0, skipped: u32 = 0 };

pub fn read(io: std.Io, dir: std.Io.Dir, root: *const [32]u8, out: *[remembered.capacity]remembered.Record) ReadError!Loaded {
    // Reject FIFOs before opening them. The caller must not replace files in this directory concurrently.
    const stat = try dir.statFile(io, name, .{ .follow_symlinks = false });
    if (stat.kind != .file) return error.NotRegularFile;
    if (stat.size > bytes_max) return error.FileTooLarge;
    var buffer: [bytes_max + 1]u8 = undefined;
    return decode(try dir.readFile(io, name, &buffer), root, out);
}

pub fn decode(bytes: []const u8, root: *const [32]u8, out: *[remembered.capacity]remembered.Record) DecodeError!Loaded {
    if (bytes.len > bytes_max) return error.FileTooLarge;
    var lines = std.mem.splitScalar(u8, bytes, '\n');
    const first = lines.next() orelse return error.InvalidHeader;
    if (first.len > line_max) return error.InvalidHeader;
    var fields = std.mem.tokenizeAny(u8, first, " \t\r");
    if (!std.mem.eql(u8, fields.next() orelse return error.InvalidHeader, header)) return error.InvalidHeader;
    const root_text = fields.next() orelse return error.InvalidHeader;
    if (root_text.len != 64 or fields.next() != null) return error.InvalidHeader;
    var parsed_root: [32]u8 = undefined;
    _ = std.fmt.hexToBytes(&parsed_root, root_text) catch return error.InvalidHeader;
    if (!std.mem.eql(u8, &parsed_root, root)) return error.WrongNetwork;
    var loaded: Loaded = .{};
    while (lines.next()) |line| {
        if (std.mem.trim(u8, line, " \t\r").len == 0) continue;
        const record = parse(line) catch {
            loaded.skipped += 1;
            continue;
        };
        if (loaded.count == remembered.capacity) return error.TooManyRecords;
        out[loaded.count] = record;
        loaded.count += 1;
    }
    return loaded;
}

fn parse(line: []const u8) error{InvalidRecord}!remembered.Record {
    if (line.len > line_max) return error.InvalidRecord;
    var fields = std.mem.tokenizeAny(u8, line, " \t\r");
    const peer = t.PeerId.fromText(fields.next() orelse return error.InvalidRecord) catch return error.InvalidRecord;
    const ip = fields.next() orelse return error.InvalidRecord;
    const port = std.fmt.parseInt(u16, fields.next() orelse return error.InvalidRecord, 10) catch return error.InvalidRecord;
    const timestamp = std.fmt.parseInt(u64, fields.next() orelse return error.InvalidRecord, 10) catch return error.InvalidRecord;
    if (fields.next() != null) return error.InvalidRecord;
    const parsed = t.Address.parseIpText(ip, port) catch return error.InvalidRecord;
    if (parsed == .ip6 and t.Address.isIp4Mapped(parsed.ip6.bytes)) return error.InvalidRecord;
    const address = t.Address.fromNetwork(parsed);
    if (!address.isUsable()) return error.InvalidRecord;
    return .{ .peer = peer, .address = address, .qualified_at_s = timestamp };
}

pub fn write(io: std.Io, dir: std.Io.Dir, root: *const [32]u8, records: []const remembered.Record) WriteError!void {
    std.debug.assert(records.len <= remembered.capacity);
    var file = try dir.createFileAtomic(io, name, .{ .replace = true });
    defer file.deinit(io);
    var buffer: [4096]u8 = undefined;
    var writer = file.file.writer(io, &buffer);
    encode(&writer.interface, root, records) catch return writer.err.?;
    writer.interface.flush() catch return writer.err.?;
    try file.replace(io);
}

pub fn encode(writer: *std.Io.Writer, root: *const [32]u8, records: []const remembered.Record) std.Io.Writer.Error!void {
    std.debug.assert(records.len <= remembered.capacity);
    try writer.print("{s} {x}\n", .{ header, root });
    for (records) |*record| {
        var identity: [peer_id.text_length_max]u8 = undefined;
        try writer.print("{s} ", .{record.peer.toText(&identity)});
        switch (record.address) {
            .ip4 => |ip| try writer.print("{d}.{d}.{d}.{d}", .{ ip.octets[0], ip.octets[1], ip.octets[2], ip.octets[3] }),
            .ip6 => |ip| try writer.print("{f}", .{std.Io.net.Ip6Address.Unresolved{ .bytes = ip.octets, .interface_name = null }}),
        }
        try writer.print(" {d} {d}\n", .{ record.address.port(), record.qualified_at_s });
    }
}

test {
    _ = @import("remembered_file_test.zig");
}
