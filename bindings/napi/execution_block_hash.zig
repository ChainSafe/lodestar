//! JS binding for the `execution_block_hash` module. Inputs are SSZ
//! serializations; errors surface as Zig error names, like the other bindings here.

const std = @import("std");
const js = @import("zapi:zapi").js;
const ForkSeq = @import("config").ForkSeq;
const block_hash = @import("execution_block_hash");

/// `parent_beacon_block_root` is required from deneb, `execution_requests` from electra.
pub fn computeExecutionBlockHash(
    fork_seq: js.Number,
    payload: js.Uint8Array,
    parent_beacon_block_root: ?js.Uint8Array,
    execution_requests: ?js.Uint8Array,
) !js.Uint8Array {
    const fork = std.enums.fromInt(ForkSeq, try fork_seq.toU32Exact()) orelse return error.InvalidFork;
    const root: ?*const block_hash.Hash = if (parent_beacon_block_root) |array| blk: {
        const slice = try array.toSlice();
        if (slice.len != 32) return error.InvalidParentBeaconBlockRoot;
        break :blk slice[0..32];
    } else null;
    const requests: ?[]const u8 = if (execution_requests) |array| try array.toSlice() else null;

    const hash = try block_hash.computeBlockHash(fork, try payload.toSlice(), root, requests);
    return js.Uint8Array.from(&hash);
}

pub fn computeTransactionsRoot(transactions: js.Uint8Array) !js.Uint8Array {
    const root = try block_hash.computeTransactionsRoot(try transactions.toSlice());
    return js.Uint8Array.from(&root);
}
