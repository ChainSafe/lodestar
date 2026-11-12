const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const gossip = @import("network").gossipsub;

const input_max = 128 * 1024;
const body_max = 64 * 1024;
const receive_max = input_max;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    const metadata = @import("network").gossip_processor.metadata;
    inline for (std.meta.tags(gossip.topic.Kind)) |kind| {
        const value = metadata.extract(kind, switch (buf[0] % 3) {
            0 => .phase0,
            1 => .electra,
            else => .gloas,
        }, buf[0..len]);
        std.mem.doNotOptimizeAway(metadata.eligible(&value, kind, buf[0] % 3 == 0, len));
    }
    var frame = gossip.frame.Reader{};
    var small: [1024]u8 = undefined;
    var large: [receive_max]u8 = undefined;
    var offset: usize = 0;
    var steps_left: usize = 4096;
    var fields_left: usize = input_max;
    var decode_left: usize = input_max;
    var decoded: [body_max]u8 = undefined;
    const receive = gossip.receive_pool;
    var page_bytes: [receive_max]u8 = undefined;
    var links: [receive_max / receive.page_bytes]u32 = undefined;
    var item_scratch: [receive_max]u8 = undefined;
    for (0..4096) |_| {
        if (offset == len or steps_left == 0) break;
        steps_left -= 1;
        const take = @min(@as(usize, buf[offset] % 127 + 1), len - offset);
        const body: []u8 = if ((frame.declaredLen() orelse 0) > small.len) &large else &small;
        if ((frame.declaredLen() orelse 0) > body.len) return;
        const result = frame.feed(buf[offset..][0..take], body) catch return;
        if (result.consumed == 0) return;
        offset += result.consumed;
        const rpc = result.frame orelse continue;
        var pool: receive.ReceivePool = .{ .bytes = &page_bytes, .next = &links, .free_pages = links.len };
        for (&links, 0..) |*next, i| next.* = if (i + 1 == links.len) receive.none else @intCast(i + 1);
        var chain: receive.Chain = .{};
        defer pool.release(&chain);
        const prefix_len = @min(rpc.len, 1 + @as(usize, buf[0] % 64));
        var copied = prefix_len;
        for (0..links.len) |_| {
            if (copied == rpc.len) break;
            const target = pool.writable(&chain) orelse return;
            const count = @min(target.len, rpc.len - copied);
            @memcpy(target[0..count], rpc[copied..][0..count]);
            chain.len += count;
            copied += count;
        }
        std.debug.assert(copied == rpc.len);
        var reader = gossip.protobuf.RpcReader.initView(.{ .prefix = rpc[0..prefix_len], .pool = &pool, .first = chain.first, .len = rpc.len });
        var contiguous = gossip.protobuf.RpcReader.init(rpc);
        for (0..4096) |_| {
            if (steps_left == 0) return;
            steps_left -= 1;
            var mirror_fields = fields_left;
            const paged_result = reader.step(&fields_left);
            const contiguous_result = contiguous.step(&mirror_fields);
            const step = paged_result catch |err| {
                _ = contiguous_result catch |other| {
                    std.debug.assert(err == other);
                    return;
                };
                @panic("paged protobuf rejects a contiguous-valid frame");
            };
            const mirror = contiguous_result catch @panic("paged protobuf accepts a contiguous-invalid frame");
            std.debug.assert(std.meta.activeTag(step) == std.meta.activeTag(mirror));
            std.debug.assert(fields_left == mirror_fields);
            if (step == .item) {
                std.debug.assert(step.item.kind == mirror.item.kind);
                std.debug.assert(step.item.bytes.start.pos == mirror.item.bytes.start.pos);
                std.debug.assert(step.item.bytes.len == mirror.item.bytes.len);
            }
            const item = switch (step) {
                .item => |item| reader.decode(item, &item_scratch) catch break,
                .skipped => continue,
                .end, .deferred => break,
            };
            switch (item) {
                .ihave => |value| consumeIds(value.ids(), &steps_left, &fields_left),
                .iwant, .idontwant => |value| consumeIds(value.ids(), &steps_left, &fields_left),
                else => {},
            }
            if (item != .message) continue;
            const message = item.message;
            const header = gossip.admission.inspect(&message);
            if (header != .payload or header.payload > decoded.len) continue;
            const cost = message.data.len + header.payload;
            if (cost > decode_left) return;
            decode_left -= cost;
            const admitted = gossip.admission.decode(&message, decoded[0..header.payload], .{});
            if (admitted == .valid) std.debug.assert(admitted.valid.bytes.len == header.payload);
            std.mem.doNotOptimizeAway(admitted);
        }
    }
}

fn consumeIds(value: gossip.protobuf.IdIterator, steps_left: *usize, fields_left: *usize) void {
    var ids = value;
    const field_bound = @min(ids.reader.data.len, 8192);
    if (field_bound > fields_left.*) return;
    fields_left.* -= field_bound;
    for (0..4096) |_| {
        if (steps_left.* == 0) return;
        steps_left.* -= 1;
        const id = ids.next() catch return;
        if (id == null) return;
        std.mem.doNotOptimizeAway(id.?);
    }
}
