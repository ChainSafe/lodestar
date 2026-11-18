//! Preregistrations bind a new public key to withdrawal credentials, and for a
//! validator to a VRF root, so that nobody else can deposit for it first. The
//! system contract verifies the key's signature before it emits the request.

const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const preset = @import("preset").preset;
const pq = @import("../utils/pq.zig");
const findBuilderIndexByPubkey = @import("../utils/gloas.zig").findBuilderIndexByPubkey;

const fork = ForkSeq.pq;
const State = BeaconState(fork);

pub const Kind = enum {
    validator,
    builder,

    fn field(comptime kind: Kind) []const u8 {
        return @tagName(kind) ++ "_preregistrations";
    }

    pub fn Stored(comptime kind: Kind) type {
        return switch (kind) {
            .validator => ForkTypes(fork).ValidatorPreregistration.Type,
            .builder => ForkTypes(fork).BuilderPreregistration.Type,
        };
    }

    fn List(comptime kind: Kind) type {
        return switch (kind) {
            .validator => ForkTypes(fork).ValidatorPreregistrations.Type,
            .builder => ForkTypes(fork).BuilderPreregistrations.Type,
        };
    }
};

/// The slot of the parent payload, whose execution requests a block applies.
fn parentPayloadSlot(state: *State) !u64 {
    var bid = try state.inner.getReadonly("latest_execution_payload_bid");
    return bid.get("slot");
}

fn storedIndex(comptime kind: Kind, state: *State, pubkey: *const pq.XmssPubkey) !?usize {
    var stored = try state.inner.get(kind.field());
    try stored.commit();
    var it = stored.iteratorReadonly(0);
    for (0..try stored.length()) |index| {
        const preregistration = try it.nextValue();
        if (std.mem.eql(u8, &preregistration.pubkey, pubkey)) return index;
    }
    return null;
}

/// The unexpired preregistration of `pubkey`, if any.
pub fn getActivePreregistration(comptime kind: Kind, state: *State, pubkey: *const pq.XmssPubkey) !?kind.Stored() {
    const index = try storedIndex(kind, state, pubkey) orelse return null;
    var stored = try state.inner.getReadonly(kind.field());
    var preregistration: kind.Stored() = undefined;
    try stored.getValue(undefined, index, &preregistration);
    if (try parentPayloadSlot(state) >= preregistration.expiry_slot) return null;
    return preregistration;
}

const Keep = union(enum) { active_at: u64, not: *const pq.XmssPubkey };

/// Rewrites the stored preregistrations in order, keeping those `keep` selects.
fn retain(comptime kind: Kind, allocator: Allocator, state: *State, keep: Keep) !void {
    var stored = try state.inner.get(kind.field());
    try stored.commit();
    var kept: kind.List() = .empty;
    defer kept.deinit(allocator);
    const len = try stored.length();
    try kept.ensureTotalCapacity(allocator, len);
    var it = stored.iteratorReadonly(0);
    for (0..len) |_| {
        const preregistration = try it.nextValue();
        const keeps = switch (keep) {
            .active_at => |slot| slot < preregistration.expiry_slot,
            .not => |pubkey| !std.mem.eql(u8, &preregistration.pubkey, pubkey),
        };
        if (keeps) kept.appendAssumeCapacity(preregistration);
    }
    if (kept.items.len != len) try state.inner.setValue(kind.field(), &kept);
}

pub fn removePreregistration(comptime kind: Kind, allocator: Allocator, state: *State, pubkey: *const pq.XmssPubkey) !void {
    try retain(kind, allocator, state, .{ .not = pubkey });
}

/// Drops expired preregistrations. They were already unenforced.
pub fn processPreregistrationExpiry(comptime f: ForkSeq, allocator: Allocator, state: *BeaconState(f)) !void {
    comptime std.debug.assert(f == fork);
    const parent_slot = try parentPayloadSlot(state);
    try retain(.validator, allocator, state, .{ .active_at = parent_slot });
    try retain(.builder, allocator, state, .{ .active_at = parent_slot });
}

fn isPendingValidator(state: *State, pubkey: *const pq.XmssPubkey) !bool {
    var pending_deposits = try state.pendingDeposits();
    try pending_deposits.commit();
    var it = pending_deposits.iteratorReadonly(0);
    for (0..try pending_deposits.length()) |_| {
        const deposit = try it.nextValue();
        if (std.mem.eql(u8, &pq.computeDepositPubkey(&deposit.pubkey), pubkey)) return true;
    }
    return false;
}

/// Stores `preregistration` unless its key is bound already or the active records are at their limit.
fn store(comptime kind: Kind, state: *State, preregistration: *const kind.Stored()) !void {
    var stored = try state.inner.get(kind.field());
    const parent_slot = try parentPayloadSlot(state);
    var active: usize = 0;
    try stored.commit();
    var it = stored.iteratorReadonly(0);
    for (0..try stored.length()) |_| {
        if (parent_slot < (try it.nextValue()).expiry_slot) active += 1;
    }
    if (active >= preset.PREREGISTRATIONS_LIMIT) return;

    // An expired record of the key is replaced in place.
    if (try storedIndex(kind, state, &preregistration.pubkey)) |index| {
        try stored.setValue(index, preregistration);
    } else {
        try stored.pushValue(preregistration);
    }
}

pub fn processValidatorPreregistrationRequest(
    comptime f: ForkSeq,
    io: std.Io,
    epoch_cache: *const EpochCache,
    state: *BeaconState(f),
    request: *const ForkTypes(fork).ValidatorPreregistrationRequest.Type,
) !void {
    comptime std.debug.assert(f == fork);
    const pubkey = &request.pubkey;

    if (try getActivePreregistration(.validator, state, pubkey) != null) return;
    if (epoch_cache.pubkey_cache.getXmss(io, pubkey)) |index| {
        if (index < try state.validatorsCount()) return;
    }
    if (try isPendingValidator(state, pubkey)) return;

    try store(.validator, state, &.{
        .pubkey = pubkey.*,
        .withdrawal_credentials = request.withdrawal_credentials,
        .vrf_root = request.vrf_root,
        .expiry_slot = try state.slot() + preset.PREREGISTRATION_EXPIRY_SLOTS,
    });
}

pub fn processBuilderPreregistrationRequest(
    comptime f: ForkSeq,
    allocator: Allocator,
    state: *BeaconState(f),
    request: *const ForkTypes(fork).BuilderPreregistrationRequest.Type,
) !void {
    comptime std.debug.assert(f == fork);
    const pubkey = &request.pubkey;

    if (try getActivePreregistration(.builder, state, pubkey) != null) return;
    if (try findBuilderIndexByPubkey(fork, allocator, state, &pq.requestPubkey(pubkey)) != null) return;

    try store(.builder, state, &.{
        .pubkey = pubkey.*,
        .withdrawal_credentials = request.withdrawal_credentials,
        .expiry_slot = try state.slot() + preset.PREREGISTRATION_EXPIRY_SLOTS,
    });
}
