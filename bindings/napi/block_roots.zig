//! Roots of a serialized signed block, computed with a single pass over the execution payload transactions.

const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const c = @import("config");
const fork_types = @import("fork_types");
const AnySignedBeaconBlock = fork_types.AnySignedBeaconBlock;

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug) gpa.allocator() else std.heap.c_allocator;

/// The caller must use the compiled preset without custom SSZ limits.
/// Returns `block_root ++ body_root` (64 bytes) for a full signed block of fork `fork_seq`. Forks whose
/// block body carries an execution payload append the payload's `transactions_root` (96 bytes).
pub fn signedBlockRoots(fork_seq: js.Number, signed_block_bytes: js.Uint8Array) !js.Uint8Array {
    const fork = std.enums.fromInt(c.ForkSeq, try fork_seq.toU32Exact()) orelse return error.InvalidForkSeq;
    const signed_block = try AnySignedBeaconBlock.deserialize(allocator, .full, fork, try signed_block_bytes.toSlice());
    defer signed_block.deinit(allocator);
    const roots = try signed_block.beaconBlock().roots(allocator, null);

    const result = try js.Uint8Array.alloc(if (roots.transactions == null) 64 else 96);
    const out = try result.toSlice();
    out[0..32].* = roots.block;
    out[32..64].* = roots.body;
    if (roots.transactions) |root| out[64..96].* = root;
    return result;
}
