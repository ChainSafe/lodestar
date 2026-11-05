//! JS binding for the `swap_or_not_shuffle` module. Function names and
//! argument order match `@chainsafe/swap-or-not-shuffle`; errors surface as
//! Zig error names, like the other bindings here.

const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const sons = @import("swap_or_not_shuffle");

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug) gpa.allocator() else std.heap.c_allocator;

fn byteCountFromJs(rand_byte_count: js.Number) !sons.ByteCount {
    return switch (rand_byte_count.assertI32()) {
        1 => .one,
        2 => .two,
        else => error.InvalidByteCount,
    };
}

/// Shuffles `out` in place, no allocation.
pub fn innerShuffleList(list: js.Uint32Array, seed: js.Uint8Array, rounds: js.Number, forwards: js.Boolean) !void {
    const list_u32 = try list.toSlice();
    const seed_slice = try seed.toSlice();

    const rounds_i32 = rounds.assertI32();
    if (rounds_i32 < 0) return error.InvalidRoundsSize;
    if (rounds_i32 > 255) return error.InvalidRoundsSize;

    const is_forwards = forwards.assertBool();

    try sons.innerShuffleList(u32, list_u32, seed_slice, rounds_i32, is_forwards);
}

/// Copies the input array and un-shuffles the copy.
///
/// Returns the copy.
pub fn unshuffleList(active_indices: js.Uint32Array, seed: js.Uint8Array, rounds: js.Number) !js.Uint32Array {
    const input = try active_indices.toSlice();
    const out_array = try js.Uint32Array.alloc(input.len);
    const out = try out_array.toSlice();
    @memcpy(out, input);

    const forwards = false;
    try sons.innerShuffleList(u32, out, try seed.toSlice(), rounds.assertI32(), forwards);
    return out_array;
}

pub fn computeProposerIndex(
    seed: js.Uint8Array,
    active_indices: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    rand_byte_count: js.Number,
    max_effective_balance: js.Number,
    effective_balance_increment: js.Number,
    rounds: js.Number,
) !js.Number {
    const result = try sons.computeProposerIndex(
        allocator,
        try seed.toSlice(),
        try active_indices.toSlice(),
        try effective_balance_increments.toSlice(),
        try byteCountFromJs(rand_byte_count),
        max_effective_balance.assertI64(),
        effective_balance_increment.assertI64(),
        rounds.assertU32(),
    );
    return js.Number.from(result);
}

pub fn computeSyncCommitteeIndices(
    seed: js.Uint8Array,
    active_indices: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    rand_byte_count: js.Number,
    sync_committee_size: js.Number,
    max_effective_balance: js.Number,
    effective_balance_increment: js.Number,
    rounds: js.Number,
) !js.Uint32Array {
    const out_array = try js.Uint32Array.alloc(sync_committee_size.assertU32());
    try sons.computeSyncCommitteeIndicesInto(
        allocator,
        try seed.toSlice(),
        try active_indices.toSlice(),
        try effective_balance_increments.toSlice(),
        try byteCountFromJs(rand_byte_count),
        max_effective_balance.assertI64(),
        effective_balance_increment.assertI64(),
        rounds.assertU32(),
        try out_array.toSlice(),
    );
    return out_array;
}

pub fn computePtcIndices(
    seed: js.Uint8Array,
    indices: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    ptc_size: js.Number,
    max_effective_balance_electra: js.Number,
    effective_balance_increment: js.Number,
) !js.Uint32Array {
    const out_array = try js.Uint32Array.alloc(try ptc_size.toU32Exact());
    try sons.computePtcIndicesInto(
        try seed.toSlice(),
        try indices.toSlice(),
        try effective_balance_increments.toSlice(),
        max_effective_balance_electra.assertI64(),
        effective_balance_increment.assertI64(),
        try out_array.toSlice(),
    );
    return out_array;
}

pub fn computePtcIndicesForEpoch(
    epoch_seed: js.Uint8Array,
    start_slot: js.Number,
    slots_per_epoch: js.Number,
    shuffling: js.Uint32Array,
    slot_offsets: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    ptc_size: js.Number,
    max_effective_balance_electra: js.Number,
    effective_balance_increment: js.Number,
) !js.Uint32Array {
    const slots = try slots_per_epoch.toU32Exact();
    const size = try ptc_size.toU32Exact();
    const out_array = try js.Uint32Array.alloc(@as(usize, slots) * size);
    try sons.computePtcIndicesForEpochInto(
        try epoch_seed.toSlice(),
        try start_slot.toU32Exact(),
        slots,
        try shuffling.toSlice(),
        try slot_offsets.toSlice(),
        try effective_balance_increments.toSlice(),
        size,
        max_effective_balance_electra.assertI64(),
        effective_balance_increment.assertI64(),
        try out_array.toSlice(),
    );
    return out_array;
}

/// Fills the caller's `out` array instead of allocating a new one; its length
/// is the committee size.
pub fn computePtcIndicesInto(
    out: js.Uint32Array,
    seed: js.Uint8Array,
    indices: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    max_effective_balance_electra: js.Number,
    effective_balance_increment: js.Number,
) !void {
    try sons.computePtcIndicesInto(
        try seed.toSlice(),
        try indices.toSlice(),
        try effective_balance_increments.toSlice(),
        max_effective_balance_electra.assertI64(),
        effective_balance_increment.assertI64(),
        try out.toSlice(),
    );
}

/// Fills the caller's `out` array instead of allocating a new one; it must hold
/// `slotsPerEpoch * ptcSize` entries.
pub fn computePtcIndicesForEpochInto(
    out: js.Uint32Array,
    epoch_seed: js.Uint8Array,
    start_slot: js.Number,
    slots_per_epoch: js.Number,
    shuffling: js.Uint32Array,
    slot_offsets: js.Uint32Array,
    effective_balance_increments: js.Uint16Array,
    ptc_size: js.Number,
    max_effective_balance_electra: js.Number,
    effective_balance_increment: js.Number,
) !void {
    try sons.computePtcIndicesForEpochInto(
        try epoch_seed.toSlice(),
        try start_slot.toU32Exact(),
        try slots_per_epoch.toU32Exact(),
        try shuffling.toSlice(),
        try slot_offsets.toSlice(),
        try effective_balance_increments.toSlice(),
        try ptc_size.toU32Exact(),
        max_effective_balance_electra.assertI64(),
        effective_balance_increment.assertI64(),
        try out.toSlice(),
    );
}
