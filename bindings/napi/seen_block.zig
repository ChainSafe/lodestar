const std = @import("std");
const js = @import("zapi:zapi").js;
const NativeSeenBlock = @import("beacon_node").chain.seen_cache.SeenBlock;
const Rc = @import("state_transition").RefCount(NativeSeenBlock);
const allocator = std.heap.c_allocator;

pub const js_meta = js.class(.{ .properties = .{
    .size = js.prop(.{ .get = true, .set = false }),
    .byteSize = js.prop(.{ .get = true, .set = false }),
} });

owner: ?*Rc,
const SeenBlock = @This();

pub fn init(max_blocks: js.Number, max_bytes: js.Number, max_block_bytes: js.Number) !SeenBlock {
    const blocks = try max_blocks.toU32Exact();
    const bytes = try max_bytes.toU32Exact();
    const block_bytes = try max_block_bytes.toU32Exact();
    if (blocks > 1_000_000) return error.InvalidOptions;
    var cache = try NativeSeenBlock.init(allocator, .{
        .max_blocks = blocks,
        .max_bytes = bytes,
        .max_block_bytes = block_bytes,
    });
    errdefer cache.deinit();
    return .{ .owner = try Rc.create(allocator, cache) };
}

pub fn deinit(self: *SeenBlock) void {
    if (self.owner) |owner| {
        self.owner = null;
        owner.unref();
    }
}

pub fn release(self: *SeenBlock) void {
    self.deinit();
}

pub fn add(self: *SeenBlock, root: js.Uint8Array, bytes: js.Uint8Array) !js.Boolean {
    const owner = self.owner orelse return error.SeenBlockReleased;
    const key = try root.toArray(32);
    return js.Boolean.from(try owner.instance.add(key, try bytes.toSlice()));
}

pub fn get(self: *SeenBlock, root: js.Uint8Array) !?js.Uint8Array {
    const owner = self.owner orelse return error.SeenBlockReleased;
    const bytes = owner.instance.get(try root.toArray(32)) orelse return null;
    return js.Uint8Array.from(bytes);
}

pub fn has(self: *SeenBlock, root: js.Uint8Array) !js.Boolean {
    const owner = self.owner orelse return error.SeenBlockReleased;
    return js.Boolean.from(owner.instance.has(try root.toArray(32)));
}

pub fn remove(self: *SeenBlock, root: js.Uint8Array) !js.Boolean {
    const owner = self.owner orelse return error.SeenBlockReleased;
    return js.Boolean.from(owner.instance.remove(try root.toArray(32)));
}

pub fn clear(self: *SeenBlock) !void {
    const owner = self.owner orelse return error.SeenBlockReleased;
    owner.instance.clear();
}

pub fn size(self: *SeenBlock) !js.Number {
    const owner = self.owner orelse return error.SeenBlockReleased;
    return js.Number.from(owner.instance.size());
}

pub fn byteSize(self: *SeenBlock) !js.Number {
    const owner = self.owner orelse return error.SeenBlockReleased;
    return js.Number.from(owner.instance.byteSize());
}
