const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const c = @import("constants");
const preset = @import("preset").preset;
const computeDomain = @import("../utils/domain.zig").computeDomain;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const pq = @import("../utils/pq.zig");

const fork = ForkSeq.pq;
const State = BeaconState(fork);
const StoredPreregistration = ForkTypes(fork).StoredPreregistration.Type;
const PreregistrationRequest = ForkTypes(fork).PreregistrationRequest.Type;

/// The slot of the parent payload, whose execution requests a block applies.
fn parentPayloadSlot(state: *State) !u64 {
    var bid = try state.inner.getReadonly("latest_execution_payload_bid");
    return bid.get("slot");
}

fn storedIndex(state: *State, pubkey: *const pq.XmssPubkey) !?usize {
    var stored = try state.inner.get("validator_preregistrations");
    try stored.commit();
    var it = stored.iteratorReadonly(0);
    for (0..try stored.length()) |index| {
        const preregistration = try it.nextValue();
        if (std.mem.eql(u8, &preregistration.pubkey, pubkey)) return index;
    }
    return null;
}

/// The unexpired preregistration of `pubkey`, if any.
pub fn getActivePreregistration(state: *State, pubkey: *const pq.XmssPubkey) !?StoredPreregistration {
    const index = try storedIndex(state, pubkey) orelse return null;
    var stored = try state.inner.getReadonly("validator_preregistrations");
    var preregistration: StoredPreregistration = undefined;
    try stored.getValue(undefined, index, &preregistration);
    if (try parentPayloadSlot(state) >= preregistration.expiry_slot) return null;
    return preregistration;
}

const Keep = union(enum) { active_at: u64, not: *const pq.XmssPubkey };

/// Rewrites the stored preregistrations in order, keeping those `keep` selects.
fn retain(allocator: Allocator, state: *State, keep: Keep) !void {
    var stored = try state.inner.get("validator_preregistrations");
    try stored.commit();
    var kept: ForkTypes(fork).ValidatorPreregistrations.Type = .empty;
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
    if (kept.items.len != len) try state.inner.setValue("validator_preregistrations", &kept);
}

pub fn removeStoredPreregistration(allocator: Allocator, state: *State, pubkey: *const pq.XmssPubkey) !void {
    try retain(allocator, state, .{ .not = pubkey });
}

/// Drops expired preregistrations. They were already unenforced.
pub fn processPreregistrationExpiry(comptime f: ForkSeq, allocator: Allocator, state: *BeaconState(f)) !void {
    comptime std.debug.assert(f == fork);
    try retain(allocator, state, .{ .active_at = try parentPayloadSlot(state) });
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

fn isValidPreregistrationSignature(config: *const BeaconConfig, state: *State, request: *const PreregistrationRequest) !bool {
    const preregistration: ForkTypes(fork).ValidatorPreregistration.Type = .{
        .pubkey = request.pubkey,
        .withdrawal_credentials = request.withdrawal_credentials,
        .vrf_root = request.vrf_root,
    };
    var domain: [32]u8 = undefined;
    try computeDomain(c.DOMAIN_PREREGISTRATION, config.chain.GENESIS_FORK_VERSION, (try state.genesisValidatorsRoot()).*, &domain);
    var signing_root: [32]u8 = undefined;
    try computeSigningRoot(ForkTypes(fork).ValidatorPreregistration, &preregistration, &domain, &signing_root);
    return pq.xmssVerify(&request.pubkey, c.RESERVED_LEAF_PREREGISTRATION, &signing_root, &request.signature);
}

/// Binds a new public key to withdrawal credentials and a VRF root, so that
/// nobody else can deposit for it first.
pub fn processPreregistrationRequest(
    comptime f: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(f),
    request: *const PreregistrationRequest,
) !void {
    comptime std.debug.assert(f == fork);
    _ = allocator;
    const pubkey = &request.pubkey;

    if (try getActivePreregistration(state, pubkey) != null) return;
    if (epoch_cache.pubkey_cache.getXmss(io, pubkey)) |index| {
        if (index < try state.validatorsCount()) return;
    }
    if (try isPendingValidator(state, pubkey)) return;

    var stored = try state.inner.get("validator_preregistrations");
    const parent_slot = try parentPayloadSlot(state);
    var active: usize = 0;
    try stored.commit();
    var it = stored.iteratorReadonly(0);
    for (0..try stored.length()) |_| {
        if (parent_slot < (try it.nextValue()).expiry_slot) active += 1;
    }
    if (active >= preset.PREREGISTRATIONS_LIMIT) return;

    if (!try isValidPreregistrationSignature(config, state, request)) return;

    const preregistration: StoredPreregistration = .{
        .pubkey = pubkey.*,
        .withdrawal_credentials = request.withdrawal_credentials,
        .vrf_root = request.vrf_root,
        .expiry_slot = try state.slot() + preset.PREREGISTRATION_EXPIRY_SLOTS,
    };
    if (try storedIndex(state, pubkey)) |index| {
        try stored.setValue(index, &preregistration);
    } else {
        try stored.pushValue(&preregistration);
    }
}
