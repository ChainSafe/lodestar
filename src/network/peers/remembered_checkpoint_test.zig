const std = @import("std");
const Checkpoint = @import("remembered_checkpoint.zig");
const file = @import("remembered_file.zig");
const remembered = @import("remembered.zig");
const keys = @import("../wire/keys.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const wait_timeout: std.Io.Timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(5) } };

const Gate = struct {
    io: std.Io,
    entered: std.Io.Event = .unset,
    release: std.Io.Event = .unset,
    failure: bool = false,
    var active: *Gate = undefined;

    fn create(context: ?*anyopaque, dir: std.Io.Dir, path: []const u8, options: std.Io.Dir.CreateFileAtomicOptions) std.Io.Dir.CreateFileAtomicError!std.Io.File.Atomic {
        const self = active;
        self.entered.set(self.io);
        try self.release.wait(self.io);
        return self.io.vtable.dirCreateFileAtomic(context, dir, path, options);
    }

    fn rename(context: ?*anyopaque, old: std.Io.Dir, old_path: []const u8, new: std.Io.Dir, new_path: []const u8) std.Io.Dir.RenameError!void {
        const self = active;
        self.entered.set(self.io);
        try self.release.wait(self.io);
        if (self.failure) return error.ReadOnlyFileSystem;
        return self.io.vtable.dirRename(context, old, old_path, new, new_path);
    }
};

test "remembered checkpoint keeps its snapshot when the source changes and another submission is refused" {
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{ .async_limit = .nothing, .concurrent_limit = .limited(1) });
    defer threaded.deinit();
    const io = threaded.io();
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var gate: Gate = .{ .io = io };
    Gate.active = &gate;
    var vtable = io.vtable.*;
    vtable.dirCreateFileAtomic = Gate.create;
    const held_io: std.Io = .{ .userdata = io.userdata, .vtable = &vtable };
    var checkpoint: Checkpoint = .{ .dir = temporary.dir, .root = @splat(7) };
    defer checkpoint.finish(held_io, null) catch {};
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    const original: remembered.Record = .{
        .peer = PeerId.fromPublicKey(&key.publicKey()),
        .address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } },
        .qualified_at_s = 123,
    };
    var source = [_]remembered.Record{original};
    try std.testing.expect(try checkpoint.start(held_io, &source));
    try gate.entered.waitTimeout(io, wait_timeout);
    source[0].qualified_at_s = 456;
    try std.testing.expect(!try checkpoint.start(held_io, &source));
    gate.release.set(io);
    try checkpoint.done.waitTimeout(io, wait_timeout);
    try std.testing.expect(try checkpoint.collect(held_io));
    var records: [remembered.capacity]remembered.Record = undefined;
    try std.testing.expectEqual(1, (try file.read(io, temporary.dir, &checkpoint.root, &records)).count);
    try std.testing.expectEqualDeep(original, records[0]);
}

test "remembered checkpoint owns one write, skips busy submissions, and preserves old files on cancel or failure" {
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{ .async_limit = .nothing, .concurrent_limit = .limited(1) });
    defer threaded.deinit();
    const io = threaded.io();
    var temporary = std.testing.tmpDir(.{ .iterate = true });
    defer temporary.cleanup();
    for ([_]enum { cancel, fail, commit }{ .cancel, .fail, .commit }) |mode| {
        try temporary.dir.writeFile(io, .{ .sub_path = file.name, .data = "previous" });
        var gate: Gate = .{ .io = io, .failure = mode == .fail };
        Gate.active = &gate;
        var vtable = io.vtable.*;
        vtable.dirRename = Gate.rename;
        const held_io: std.Io = .{ .userdata = io.userdata, .vtable = &vtable };
        var checkpoint: Checkpoint = .{ .dir = temporary.dir, .root = @splat(7) };
        defer checkpoint.finish(held_io, null) catch {};
        try std.testing.expect(try checkpoint.start(held_io, &.{}));
        try gate.entered.waitTimeout(io, wait_timeout);
        try std.testing.expect(!try checkpoint.collect(held_io));
        try std.testing.expect(!try checkpoint.start(held_io, &.{}));
        if (mode != .cancel) gate.release.set(io);
        const deadline = std.Io.Clock.Timestamp.now(io, .awake).addDuration(.{ .clock = .awake, .raw = .fromSeconds(2) });
        if (mode == .cancel) {
            try std.testing.expectError(error.Canceled, checkpoint.finish(held_io, std.Io.Clock.Timestamp.now(io, .awake)));
        } else if (mode == .fail) {
            try checkpoint.done.waitTimeout(io, wait_timeout);
            try std.testing.expectError(error.ReadOnlyFileSystem, checkpoint.collect(held_io));
        } else {
            try checkpoint.finish(held_io, deadline);
        }
        try std.testing.expect(checkpoint.future == null);
        var buffer: [128]u8 = undefined;
        const bytes = try temporary.dir.readFile(io, file.name, &buffer);
        if (mode == .commit) {
            try std.testing.expect(std.mem.startsWith(u8, bytes, "lodestar-peers-v1 "));
        } else {
            try std.testing.expectEqualStrings("previous", bytes);
        }
        var entries = temporary.dir.iterate();
        try std.testing.expectEqualStrings(file.name, (try entries.next(io)).?.name);
        try std.testing.expect(try entries.next(io) == null);
        try std.testing.expect(try checkpoint.start(io, &.{}));
        try checkpoint.done.waitTimeout(io, wait_timeout);
        try std.testing.expect(try checkpoint.collect(io));
        try std.testing.expect(!try checkpoint.collect(io));
    }
}

test "remembered checkpoint creates missing directories and never writes inline without concurrency" {
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{ .async_limit = .nothing, .concurrent_limit = .nothing });
    defer threaded.deinit();
    const io = threaded.io();
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var path_buffer: [std.fs.max_path_bytes]u8 = undefined;
    const parent_len = try temporary.dir.realPath(io, &path_buffer);
    var nested_buffer: [std.fs.max_path_bytes]u8 = undefined;
    const path = try std.fmt.bufPrint(&nested_buffer, "{s}/missing/peers", .{path_buffer[0..parent_len]});
    var checkpoint = try Checkpoint.init(io, path, &@as([32]u8, @splat(7)));
    defer checkpoint.deinit(io);
    try std.testing.expectError(error.ConcurrencyUnavailable, checkpoint.start(io, &.{}));
    try checkpoint.finish(io, null);
    try std.testing.expectError(error.FileNotFound, checkpoint.dir.statFile(io, file.name, .{}));
}
