const std = @import("std");
const builtin = @import("builtin");
const napi = @import("zapi:zapi").napi;
const js = @import("zapi:zapi").js;
const c = @import("config");
const fork_types = @import("fork_types");
const st = @import("state_transition");
const CachedBeaconState = st.CachedBeaconState;
const AnyBeaconState = fork_types.AnyBeaconState;
const AnyExecutionPayloadHeader = fork_types.AnyExecutionPayloadHeader;
const AnySignedBeaconBlock = fork_types.AnySignedBeaconBlock;
const BlockType = fork_types.BlockType;
const preset = @import("preset").preset;
const ct = @import("consensus_types");
const pool = @import("./pool.zig");
const BeaconConfig = @import("./BeaconConfig.zig");
const OwnedConfigRc = BeaconConfig.OwnedConfigRc;
const pubkey = @import("./pubkeys.zig");
const js_types = @import("./js_types.zig");
const sszValueToNapiValue = @import("./to_napi_value.zig").sszValueToNapiValue;
const numberSliceToNapiValue = @import("./to_napi_value.zig").numberSliceToNapiValue;
const validator_monitor = @import("./validator_monitor.zig");

pub const js_meta = js.class(.{ .properties = .{
    .slot = js.prop(.{ .get = true, .set = false }),
    .fork = js.prop(.{ .get = true, .set = false }),
    .forkName = js.prop(.{ .get = true, .set = false }),
    .forkSeq = js.prop(.{ .get = true, .set = false }),
    .epoch = js.prop(.{ .get = true, .set = false }),
    .genesisTime = js.prop(.{ .get = true, .set = false }),
    .genesisValidatorsRoot = js.prop(.{ .get = true, .set = false }),
    .eth1Data = js.prop(.{ .get = true, .set = false }),
    .latestBlockHeader = js.prop(.{ .get = true, .set = false }),
    .previousJustifiedCheckpoint = js.prop(.{ .get = true, .set = false }),
    .currentJustifiedCheckpoint = js.prop(.{ .get = true, .set = false }),
    .finalizedCheckpoint = js.prop(.{ .get = true, .set = false }),
    .previousEpochParticipation = js.prop(.{ .get = true, .set = false }),
    .currentEpochParticipation = js.prop(.{ .get = true, .set = false }),
    .latestExecutionPayloadHeader = js.prop(.{ .get = true, .set = false }),
    .payloadBlockNumber = js.prop(.{ .get = true, .set = false }),
    .historicalSummaries = js.prop(.{ .get = true, .set = false }),
    .pendingDeposits = js.prop(.{ .get = true, .set = false }),
    .pendingDepositsCount = js.prop(.{ .get = true, .set = false }),
    .pendingPartialWithdrawals = js.prop(.{ .get = true, .set = false }),
    .pendingPartialWithdrawalsCount = js.prop(.{ .get = true, .set = false }),
    .pendingConsolidations = js.prop(.{ .get = true, .set = false }),
    .pendingConsolidationsCount = js.prop(.{ .get = true, .set = false }),
    .proposerLookahead = js.prop(.{ .get = true, .set = false }),
    .previousDecisionRoot = js.prop(.{ .get = true, .set = false }),
    .currentDecisionRoot = js.prop(.{ .get = true, .set = false }),
    .nextDecisionRoot = js.prop(.{ .get = true, .set = false }),
    .currentProposers = js.prop(.{ .get = true, .set = false }),
    .nextProposers = js.prop(.{ .get = true, .set = false }),
    .previousProposers = js.prop(.{ .get = true, .set = false }),
    .currentSyncCommittee = js.prop(.{ .get = true, .set = false }),
    .currentSyncCommitteeIndexed = js.prop(.{ .get = true, .set = false }),
    .currentSyncCommitteeValidatorIndices = js.prop(.{ .get = true, .set = false }),
    .nextSyncCommittee = js.prop(.{ .get = true, .set = false }),
    .syncProposerReward = js.prop(.{ .get = true, .set = false }),
    .effectiveBalanceIncrements = js.prop(.{ .get = true, .set = false }),
    .validatorCount = js.prop(.{ .get = true, .set = false }),
    .activeValidatorCount = js.prop(.{ .get = true, .set = false }),
    .isExecutionStateType = js.prop(.{ .get = true, .set = false }),
    .isMergeTransitionComplete = js.prop(.{ .get = true, .set = false }),
    .proposerRewards = js.prop(.{ .get = true, .set = false }),
    .clonedCount = js.prop(.{ .get = true, .set = false }),
    .clonedCountWithTransferCache = js.prop(.{ .get = true, .set = false }),
    .createdWithTransferCache = js.prop(.{ .get = true, .set = false }),
    .latestBlockHash = js.prop(.{ .get = true, .set = false }),
    .executionPayloadAvailability = js.prop(.{ .get = true, .set = false }),
    .latestExecutionPayloadBid = js.prop(.{ .get = true, .set = false }),
    .payloadExpectedWithdrawals = js.prop(.{ .get = true, .set = false }),
} });

cached_state: ?*CachedBeaconState = null,
pool_rc: @TypeOf(pool.state.pool_rc) = null,
config_rc: ?*OwnedConfigRc = null,
active_calls: u32 = 0,
release_requested: bool = false,
const BeaconStateView = @This();

pub fn init() BeaconStateView {
    return .{};
}

pub fn deinit(self: *BeaconStateView) void {
    std.debug.assert(self.active_calls == 0);
    self.release_requested = true;
    if (self.cached_state) |cached_state| {
        const allocator = cached_state.allocator;
        cached_state.deinit();
        allocator.destroy(cached_state);
        self.cached_state = null;
    }
    if (self.config_rc) |rc| {
        rc.unref();
        self.config_rc = null;
    }
    if (self.pool_rc) |rc| {
        rc.instance.reportMemory();
        rc.unref();
        self.pool_rc = null;
    }
}

pub fn release(self: *BeaconStateView) void {
    self.release_requested = true;
    if (self.active_calls == 0) self.deinit();
}

fn initCachedState(
    allocator: std.mem.Allocator,
    cached_state: *CachedBeaconState,
    io: std.Io,
    state: *AnyBeaconState,
    beacon_config: *const c.BeaconConfig,
) !void {
    try cached_state.init(
        allocator,
        io,
        state,
        .{
            .config = beacon_config,
            .pubkey_cache = &pubkey.state.cache,
        },
        null,
    );
}

fn stateBytesFork(beacon_config: *const c.BeaconConfig, bytes: []const u8) !c.ForkSeq {
    if (bytes.len < 48) return error.InvalidStateBytes;
    const fork_seq = beacon_config.forkSeq(fork_types.readSlotFromAnyBeaconStateBytes(bytes));
    if (fork_seq.gte(.gloas)) return error.UnsupportedFork;
    return fork_seq;
}

// -------------------------
// Class Methods
// -------------------------
/// Requires state bytes with trusted provenance; SSZ decoding does not authenticate them.
pub fn createFromBytes(bytes: js.Uint8Array, config: *const BeaconConfig) !BeaconStateView {
    const config_rc = config.config_rc;
    const byte_slice = try bytes.toSlice();
    const fork_seq = try stateBytesFork(&config_rc.instance.config, byte_slice);
    const pool_rc = try pool.state.poolRc();
    const owner = &pool_rc.instance;
    const allocator = owner.memory.allocator();
    defer owner.reportMemory();
    const state = try allocator.create(AnyBeaconState);
    errdefer allocator.destroy(state);

    state.* = try AnyBeaconState.deserialize(allocator, &owner.pool, fork_seq, byte_slice);
    errdefer state.deinit();

    const cached_state = try allocator.create(CachedBeaconState);
    errdefer allocator.destroy(cached_state);

    const io = js.io();
    try initCachedState(allocator, cached_state, io, state, &config_rc.instance.config);

    return .{
        .cached_state = cached_state,
        .pool_rc = pool_rc.ref(),
        .config_rc = config_rc.ref(),
    };
}

// -------------------------
// Getters
// -------------------------
pub fn slot(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value = try cached_state.state.slot();
    return js.Number.from(slot_value);
}

pub fn fork(self: *BeaconStateView) !js_types.Fork {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var fork_view = try cached_state.state.fork();
    var fork_value: ct.phase0.Fork.Type = undefined;
    try fork_view.toValue(allocator, &fork_value);
    return js_types.wrap(js_types.Fork, try sszValueToNapiValue(env, ct.phase0.Fork, &fork_value));
}

pub fn forkName(self: *BeaconStateView) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.String.from(cached_state.state.forkSeq().name());
}

pub fn forkSeq(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.Number.from(@intFromEnum(cached_state.state.forkSeq()));
}

pub fn epoch(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value = try cached_state.state.slot();
    return js.Number.from(slot_value / preset.SLOTS_PER_EPOCH);
}

pub fn genesisTime(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.Number.from(try cached_state.state.genesisTime());
}

pub fn genesisValidatorsRoot(self: *BeaconStateView) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Root, try cached_state.state.genesisValidatorsRoot()));
}

pub fn eth1Data(self: *BeaconStateView) !js_types.Eth1Data {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var eth1_data_view = try cached_state.state.eth1Data();
    var eth1_data: ct.phase0.Eth1Data.Type = undefined;
    try eth1_data_view.toValue(allocator, &eth1_data);
    return js_types.wrap(js_types.Eth1Data, try sszValueToNapiValue(env, ct.phase0.Eth1Data, &eth1_data));
}

pub fn latestBlockHeader(self: *BeaconStateView) !js_types.BeaconBlockHeader {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var header_view = try cached_state.state.latestBlockHeader();
    var header: ct.phase0.BeaconBlockHeader.Type = undefined;
    try header_view.toValue(allocator, &header);
    return js_types.wrap(js_types.BeaconBlockHeader, try sszValueToNapiValue(env, ct.phase0.BeaconBlockHeader, &header));
}

pub fn previousJustifiedCheckpoint(self: *BeaconStateView) !js_types.Checkpoint {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    var cp: ct.phase0.Checkpoint.Type = undefined;
    try cached_state.state.previousJustifiedCheckpoint(&cp);
    return js_types.wrap(js_types.Checkpoint, try sszValueToNapiValue(env, ct.phase0.Checkpoint, &cp));
}

pub fn currentJustifiedCheckpoint(self: *BeaconStateView) !js_types.Checkpoint {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    var cp: ct.phase0.Checkpoint.Type = undefined;
    try cached_state.state.currentJustifiedCheckpoint(&cp);
    return js_types.wrap(js_types.Checkpoint, try sszValueToNapiValue(env, ct.phase0.Checkpoint, &cp));
}

pub fn finalizedCheckpoint(self: *BeaconStateView) !js_types.Checkpoint {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    var cp: ct.phase0.Checkpoint.Type = undefined;
    try cached_state.state.finalizedCheckpoint(&cp);
    return js_types.wrap(js_types.Checkpoint, try sszValueToNapiValue(env, ct.phase0.Checkpoint, &cp));
}

pub fn previousEpochParticipation(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var view = try cached_state.state.previousEpochParticipation();

    const size = try view.serializedSize();
    const result = try js.Uint8Array.alloc(size);
    _ = try view.serializeIntoBytes(try result.toSlice());
    return result;
}

pub fn currentEpochParticipation(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var view = try cached_state.state.currentEpochParticipation();

    const size = try view.serializedSize();
    const result = try js.Uint8Array.alloc(size);
    _ = try view.serializeIntoBytes(try result.toSlice());
    return result;
}

pub fn getPreviousEpochParticipation(self: *BeaconStateView, index_arg: js.Number) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const index_value: usize = try index_arg.toU64Exact();
    var view = try cached_state.state.previousEpochParticipation();
    const flag = view.get(index_value) catch {
        return throwNullAs(js.Number, "INVALID_INDEX", "Failed to get previous epoch participation");
    };
    return js.Number.from(flag);
}

pub fn getCurrentEpochParticipation(self: *BeaconStateView, index_arg: js.Number) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const index_value: usize = try index_arg.toU64Exact();
    var view = try cached_state.state.currentEpochParticipation();
    const flag = view.get(index_value) catch {
        return throwNullAs(js.Number, "INVALID_INDEX", "Failed to get current epoch participation");
    };
    return js.Number.from(flag);
}

pub fn latestExecutionPayloadHeader(self: *BeaconStateView) !js.Value {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var header: AnyExecutionPayloadHeader = undefined;
    try cached_state.state.latestExecutionPayloadHeader(allocator, &header);
    defer header.deinit(allocator);

    const value = switch (header) {
        .bellatrix => |*h| try sszValueToNapiValue(env, ct.bellatrix.ExecutionPayloadHeader, h),
        .capella => |*h| try sszValueToNapiValue(env, ct.capella.ExecutionPayloadHeader, h),
        .deneb => |*h| try sszValueToNapiValue(env, ct.deneb.ExecutionPayloadHeader, h),
    };
    return js_types.wrap(js.Value, value);
}

pub fn payloadBlockNumber(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var header: AnyExecutionPayloadHeader = undefined;
    try cached_state.state.latestExecutionPayloadHeader(allocator, &header);
    defer header.deinit(allocator);

    return js.Number.from(header.blockNumber());
}

// -------------------------
// Instance Methods
// -------------------------

pub fn getBlockRoot(self: *BeaconStateView, epoch_arg: js.Number) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();

    const slot_ = st.computeStartSlotAtEpoch(epoch_value);

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.getBlockRootAtSlot(f, cached_state.state.castToFork(f), slot_),
    };
    const root = result catch |err| {
        const msg = switch (err) {
            error.SlotTooBig => "Can only get block root in the past",
            error.SlotTooSmall => "Cannot get block root more than SLOTS_PER_HISTORICAL_ROOT in the past",
            else => "Failed to get block root",
        };
        return throwNullAs(js.Uint8Array, "INVALID_SLOT", msg);
    };

    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Root, root));
}

pub fn getBlockRootAtSlot(self: *BeaconStateView, slot_arg: js.Number) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value = slot_arg.toU64Exact() catch return error.InvalidSlot;

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.getBlockRootAtSlot(f, cached_state.state.castToFork(f), slot_value),
    };
    const root = result catch |err| {
        const msg = switch (err) {
            error.SlotTooBig => "Can only get block root in the past",
            error.SlotTooSmall => "Cannot get block root more than SLOTS_PER_HISTORICAL_ROOT in the past",
            else => "Failed to get block root",
        };
        return throwNullAs(js.Uint8Array, "INVALID_SLOT", msg);
    };

    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Root, root));
}

pub fn getBlockRootAtEpoch(self: *BeaconStateView, epoch_arg: js.Number) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();
    const slot_ = st.computeStartSlotAtEpoch(epoch_value);

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.getBlockRootAtSlot(f, cached_state.state.castToFork(f), slot_),
    };
    const root = result catch |err| {
        const msg = switch (err) {
            error.SlotTooBig => "Can only get block root in the past",
            error.SlotTooSmall => "Cannot get block root more than SLOTS_PER_HISTORICAL_ROOT in the past",
            else => "Failed to get block root",
        };
        return throwNullAs(js.Uint8Array, "INVALID_EPOCH", msg);
    };

    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Root, root));
}

pub fn getRandaoMix(self: *BeaconStateView, epoch_arg: js.Number) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.getRandaoMix(f, cached_state.state.castToFork(f), epoch_value),
    };
    const mix = result catch {
        return throwNullAs(js.Uint8Array, "INVALID_EPOCH", "Failed to get randao mix for epoch");
    };

    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Bytes32, mix));
}

pub fn getStateRootAtSlot(self: *BeaconStateView, slot_arg: js.Number) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();

    var state_roots_view = cached_state.state.stateRoots() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get stateRoots");
    };
    const slot_: usize = try slot_arg.toU64Exact();
    const root = state_roots_view.getFieldRoot(slot_ % preset.SLOTS_PER_HISTORICAL_ROOT) catch {
        return throwNullAs(js.Uint8Array, "INVALID_SLOT", "Failed to get state root at slot");
    };
    return js_types.wrap(js.Uint8Array, try sszValueToNapiValue(env, ct.primitive.Root, root));
}

/// Get the historical summaries from the state (Capella+).
/// Returns: array of {blockSummaryRoot: Uint8Array, stateSummaryRoot: Uint8Array}
pub fn historicalSummaries(self: *BeaconStateView) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var historical_summaries_view = try cached_state.state.historicalSummaries();
    var historical_summaries = ct.capella.HistoricalSummaries.default_value;
    defer historical_summaries.deinit(allocator);
    try historical_summaries_view.toValue(allocator, &historical_summaries);
    return js_types.wrap(js.Array, try sszValueToNapiValue(env, ct.capella.HistoricalSummaries, &historical_summaries));
}

/// Get the pending deposits from the state (Electra+).
/// Returns: Uint8Array of SSZ serialized PendingDeposits list
pub fn pendingDeposits(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();

    var pending_deposits = cached_state.state.pendingDeposits() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingDeposits");
    };

    const size = pending_deposits.serializedSize() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingDeposits size");
    };

    const result = try js.Uint8Array.alloc(size);
    _ = pending_deposits.serializeIntoBytes(try result.toSlice()) catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to serialize pendingDeposits");
    };

    return result;
}

pub fn pendingDepositsCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var pending_deposits = try cached_state.state.pendingDeposits();
    return js.Number.from(try pending_deposits.length());
}

/// Get the pending partial withdrawals from the state (Electra+).
/// Returns: Uint8Array of SSZ serialized PendingPartialWithdrawals list
pub fn pendingPartialWithdrawals(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();

    var pending_partial_withdrawals = cached_state.state.pendingPartialWithdrawals() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingPartialWithdrawals");
    };
    const size = pending_partial_withdrawals.serializedSize() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingPartialWithdrawals size");
    };

    const result = try js.Uint8Array.alloc(size);
    _ = pending_partial_withdrawals.serializeIntoBytes(try result.toSlice()) catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to serialize pendingPartialWithdrawals");
    };
    return result;
}

pub fn pendingPartialWithdrawalsCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var pending_partial_withdrawals = try cached_state.state.pendingPartialWithdrawals();
    return js.Number.from(try pending_partial_withdrawals.length());
}

/// Get the pending consolidations from the state
pub fn pendingConsolidations(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();

    var pending_consolidations = cached_state.state.pendingConsolidations() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingConsolidations");
    };
    const size = pending_consolidations.serializedSize() catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to get pendingConsolidations size");
    };

    const result = try js.Uint8Array.alloc(size);
    _ = pending_consolidations.serializeIntoBytes(try result.toSlice()) catch {
        return throwNullAs(js.Uint8Array, "STATE_ERROR", "Failed to serialize pendingConsolidations");
    };

    return result;
}

pub fn pendingConsolidationsCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var pending_consolidations = try cached_state.state.pendingConsolidations();
    return js.Number.from(try pending_consolidations.length());
}

/// Get the proposer lookahead from the state (Fulu+).
pub fn proposerLookahead(self: *BeaconStateView) !js.Uint32Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;

    var proposer_lookahead = cached_state.state.proposerLookahead() catch {
        return throwNullAs(js.Uint32Array, "STATE_ERROR", "Failed to get proposerLookahead");
    };

    const lookahead = proposer_lookahead.getAll(allocator) catch {
        return throwNullAs(js.Uint32Array, "STATE_ERROR", "Failed to get proposerLookahead values");
    };
    defer allocator.free(lookahead);

    return .{ .val = try numberSliceToNapiValue(env, u64, lookahead, .{ .typed_array = .uint32 }) };
}

fn rootToHexString(root: *const [32]u8) !js.String {
    const env = js.env();
    var hex_buf: [66]u8 = undefined;
    try @import("hex").rootIntoHex(&hex_buf, root);
    return js_types.wrap(js.String, try env.createStringUtf8(&hex_buf));
}

pub fn previousDecisionRoot(self: *BeaconStateView) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const root = cached_state.previousDecisionRoot();
    return rootToHexString(&root);
}

pub fn currentDecisionRoot(self: *BeaconStateView) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const root = cached_state.currentDecisionRoot();
    return rootToHexString(&root);
}

/// Get the next decision root for the state.
pub fn nextDecisionRoot(self: *BeaconStateView) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const root = cached_state.nextDecisionRoot();
    return rootToHexString(&root);
}

/// Get the shuffling decision root for a given epoch.
pub fn getShufflingDecisionRoot(self: *BeaconStateView, epoch_arg: js.Number) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();
    const root = st.calculateShufflingDecisionRoot(cached_state.state, epoch_value) catch {
        return throwNullAs(js.String, "STATE_ERROR", "Failed to calculate shuffling decision root");
    };
    return rootToHexString(&root);
}

pub fn previousProposers(self: *BeaconStateView) !?js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    if (cached_state.epoch_cache.proposers_prev_epoch) |*proposers| {
        return .{ .val = try numberSliceToNapiValue(env, u64, proposers, .{}) };
    }
    return null;
}

pub fn currentProposers(self: *BeaconStateView) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    return .{ .val = try numberSliceToNapiValue(env, u64, &cached_state.epoch_cache.proposers, .{}) };
}

pub fn nextProposers(self: *BeaconStateView) !?js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    if (cached_state.epoch_cache.proposers_next_epoch) |*proposers| {
        return .{ .val = try numberSliceToNapiValue(env, u64, proposers, .{}) };
    }
    return null;
}

/// Get the beacon proposer for a given slot.
/// Arguments:
/// - arg 0: slot (number)
/// Returns: validator index of the proposer
pub fn getBeaconProposer(self: *BeaconStateView, slot_arg: js.Number) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value: u64 = try slot_arg.toU64Exact();
    const proposer = try cached_state.epoch_cache.getBeaconProposer(slot_value);
    return js.Number.from(proposer);
}

pub fn getBeaconProposerOrNull(self: *BeaconStateView, slot_arg: js.Number) !js.Value {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value: u64 = try slot_arg.toU64Exact();
    const proposer = cached_state.epoch_cache.getBeaconProposer(slot_value) catch return jsNull();
    return js_types.wrap(js.Value, js.Number.from(proposer).toValue());
}

pub fn currentSyncCommittee(self: *BeaconStateView) !js_types.SyncCommittee {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var current_sync_committee = try cached_state.state.currentSyncCommittee();
    var result: ct.altair.SyncCommittee.Type = undefined;
    try current_sync_committee.toValue(allocator, &result);
    return js_types.wrap(js_types.SyncCommittee, try sszValueToNapiValue(env, ct.altair.SyncCommittee, &result));
}

pub fn nextSyncCommittee(self: *BeaconStateView) !js_types.SyncCommittee {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var next_sync_committee = try cached_state.state.nextSyncCommittee();
    var result: ct.altair.SyncCommittee.Type = undefined;
    try next_sync_committee.toValue(allocator, &result);
    return js_types.wrap(js_types.SyncCommittee, try sszValueToNapiValue(env, ct.altair.SyncCommittee, &result));
}

pub fn currentSyncCommitteeIndexed(self: *BeaconStateView) !js_types.IndexedSyncCommittee {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const sync_committee_cache = cached_state.epoch_cache.current_sync_committee_indexed.get();
    return indexedSyncCommitteeToNapiValue(&sync_committee_cache);
}

pub fn currentSyncCommitteeValidatorIndices(self: *BeaconStateView) !js.Uint32Array {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const sync_committee_cache = cached_state.epoch_cache.current_sync_committee_indexed.get();
    const validator_indices = sync_committee_cache.getValidatorIndices() catch {
        return throwNullAs(js.Uint32Array, "NO_SYNC_COMMITTEE", "Sync committee not available for pre-Altair state");
    };
    return .{ .val = try numberSliceToNapiValue(js.env(), u64, validator_indices, .{ .typed_array = .uint32 }) };
}

fn indexedSyncCommitteeToNapiValue(sync_committee_cache: *const st.SyncCommitteeCache) !js_types.IndexedSyncCommittee {
    const env = js.env();
    const validator_indices = sync_committee_cache.getValidatorIndices() catch {
        return throwNullAs(js_types.IndexedSyncCommittee, "NO_SYNC_COMMITTEE", "Sync committee not available for pre-Altair state");
    };
    const validator_index_map = sync_committee_cache.getValidatorIndexMap() catch {
        return throwNullAs(js_types.IndexedSyncCommittee, "NO_SYNC_COMMITTEE", "Sync committee not available for pre-Altair state");
    };

    const obj = try env.createObject();
    try obj.setNamedProperty(
        "validatorIndices",
        try numberSliceToNapiValue(
            env,
            u64,
            validator_indices,
            .{ .typed_array = .uint32 },
        ),
    );

    const global = try env.getGlobal();
    const map_ctor = try global.getNamedProperty("Map");
    const map = try env.newInstance(map_ctor, .{});
    const set_fn = try map.getNamedProperty("set");

    var iterator = validator_index_map.iterator();
    while (iterator.next()) |entry| {
        const idx = entry.key_ptr.*;
        const positions = entry.value_ptr;

        const key_value_napi = try env.createInt64(@intCast(idx));
        const positions_napi = try numberSliceToNapiValue(
            env,
            u32,
            positions.items,
            .{},
        );

        _ = try env.callFunction(set_fn, map, .{ key_value_napi, positions_napi });
    }

    try obj.setNamedProperty("validatorIndexMap", map);
    return .{ .val = obj };
}

pub fn syncProposerReward(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const sync_proposer_reward = cached_state.epoch_cache.sync_proposer_reward;
    return js.Number.from(sync_proposer_reward);
}

/// Get the indexed sync committee at a given epoch.
pub fn getIndexedSyncCommitteeAtEpoch(self: *BeaconStateView, epoch_arg: js.Number) !js_types.IndexedSyncCommittee {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();

    const sync_committee = cached_state.epoch_cache.getIndexedSyncCommitteeAtEpoch(epoch_value) catch {
        return throwNullAs(js_types.IndexedSyncCommittee, "NO_SYNC_COMMITTEE", "Sync committee not available for requested epoch");
    };

    return indexedSyncCommitteeToNapiValue(&sync_committee);
}

/// Get the indexed sync committee for a given slot (uses slot+1 offset for duty lookups).
pub fn getIndexedSyncCommittee(self: *BeaconStateView, slot_arg: js.Number) !js_types.IndexedSyncCommittee {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_value: u64 = try slot_arg.toU64Exact();

    const sync_committee = cached_state.epoch_cache.getIndexedSyncCommittee(slot_value) catch {
        return throwNullAs(js_types.IndexedSyncCommittee, "NO_SYNC_COMMITTEE", "Sync committee not available for requested slot");
    };

    return indexedSyncCommitteeToNapiValue(&sync_committee);
}

pub fn effectiveBalanceIncrements(self: *BeaconStateView) !js.Uint16Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const increments = cached_state.epoch_cache.getEffectiveBalanceIncrements();
    return .{ .val = try numberSliceToNapiValue(env, u16, increments.items, .{ .typed_array = .uint16 }) };
}

pub fn getEffectiveBalanceIncrementsZeroInactive(self: *BeaconStateView) !js.Uint16Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var result = try st.getEffectiveBalanceIncrementsZeroInactive(allocator, cached_state);
    defer result.deinit(allocator);
    return .{ .val = try numberSliceToNapiValue(env, u16, result.items, .{ .typed_array = .uint16 }) };
}

pub fn getBalance(self: *BeaconStateView, index_arg: js.Number) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const index_value: u64 = try index_arg.toU64Exact();
    var balances = try cached_state.state.balances();
    const balance = try balances.get(index_value);
    return js.Number.from(balance);
}

/// Get a validator by index.
pub fn getValidator(self: *BeaconStateView, index_arg: js.Number) !js_types.Validator {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const index_value: u64 = try index_arg.toU64Exact();

    var validators = try cached_state.state.validators();
    var validator_view = try validators.get(index_value);
    var validator: ct.phase0.Validator.Type = undefined;
    try validator_view.toValue(allocator, &validator);

    return js_types.wrap(js_types.Validator, try sszValueToNapiValue(env, ct.phase0.Validator, &validator));
}

/// Get the status of a validator by index.
/// Returns: status string
pub fn getValidatorStatus(self: *BeaconStateView, index_arg: js.Number) !js.String {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const index_value: u64 = try index_arg.toU64Exact();
    const current_epoch = cached_state.epoch_cache.epoch;

    var validators = try cached_state.state.validators();
    var validator_view = try validators.get(index_value);
    var validator: ct.phase0.Validator.Type = undefined;
    try validator_view.toValue(allocator, &validator);

    const status = st.getValidatorStatus(&validator, current_epoch);
    return js.String.from(status.toString());
}

/// Get all validators in the registry.
pub fn getAllValidators(self: *BeaconStateView) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;

    const validators = try cached_state.state.validatorsSlice(allocator);
    defer allocator.free(validators);

    const result = try env.createArray();
    for (validators, 0..) |*validator, i| {
        const v_napi = try sszValueToNapiValue(env, ct.phase0.Validator, validator);
        try result.setElement(@intCast(i), v_napi);
    }
    return js_types.wrap(js.Array, result);
}

/// Get the number of builders in the registry (Gloas+). Throws on pre-Gloas states.
pub fn getBuildersLength(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const count = try cached_state.state.buildersLength();
    return js.Number.from(count);
}

/// Get all balances in the registry.
pub fn getAllBalances(self: *BeaconStateView) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;

    const balances = try cached_state.state.balancesSlice(allocator);
    defer allocator.free(balances);

    return js_types.wrap(js.Array, try numberSliceToNapiValue(env, u64, balances, .{}));
}

/// Get validators whose status is in the provided Set<string>.
/// Arguments:
/// - statuses: JS Set<string>
/// - currentEpoch: Epoch (number)
pub fn getValidatorsByStatus(self: *BeaconStateView, statuses_set: js.Value, current_epoch_arg: js.Number) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const current_epoch: u64 = try current_epoch_arg.toU64Exact();

    const set_value = statuses_set.toValue();
    const has_fn = try set_value.getNamedProperty("has");

    const validators = try cached_state.state.validatorsSlice(allocator);
    defer allocator.free(validators);

    const result = try env.createArray();
    var out_idx: u32 = 0;
    for (validators) |*validator| {
        const status = st.getValidatorStatus(validator, current_epoch);
        const status_str = try env.createStringUtf8(status.toString());
        const has_result = try env.callFunction(has_fn, set_value, .{status_str});
        if (try has_result.getValueBool()) {
            const v_napi = try sszValueToNapiValue(env, ct.phase0.Validator, validator);
            try result.setElement(out_idx, v_napi);
            out_idx += 1;
        }
    }
    return js_types.wrap(js.Array, result);
}

/// Get the total number of validators in the registry.
pub fn validatorCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const count = try cached_state.state.validatorsCount();
    return js.Number.from(count);
}

/// Get the number of active validators at the current epoch.
pub fn activeValidatorCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const count = cached_state.epoch_cache.current_shuffling.get().active_indices.len;
    return js.Number.from(count);
}

pub fn isExecutionStateType(self: *BeaconStateView) !js.Boolean {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const fork_seq = cached_state.state.forkSeq();
    return js.Boolean.from(fork_seq.gte(.bellatrix));
}

/// Check whether execution is enabled for the given Lodestar-shaped block object.
///
/// For normal post-merge operation this short-circuits from state alone and does
/// not inspect `block`. The block object is only read for the historical pre-merge
/// Bellatrix case, where execution is enabled iff the block carries the first
/// non-default execution payload.
pub fn isExecutionEnabled(self: *BeaconStateView, block: js.Value) !js.Boolean {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const fork_seq = cached_state.state.forkSeq();
    if (fork_seq.lt(.bellatrix)) return js.Boolean.from(false);

    const merge_complete: bool = switch (fork_seq) {
        inline .bellatrix, .capella, .deneb, .electra, .fulu => |f| st.isMergeTransitionComplete(f, cached_state.state.castToFork(f)),
        else => unreachable,
    };
    if (merge_complete) return js.Boolean.from(true);

    if (fork_seq != .bellatrix) return js.Boolean.from(false);

    // After the above check, we reach the slow path: pre-merge Bellatrix.
    // Walk the JS block into a native ExecutionPayload to compare against `default_value`.
    const block_raw = block.toValue();
    if (try block_raw.typeof() != .object) return error.InvalidBlockObject;

    const body = try (try block_raw.getNamedProperty("body")).coerceToObject();

    // Lodestar treats blinded pre-merge Bellatrix blocks as not-yet-merged: the state's
    // execution payload header is still default, so the block doesn't kick off the transition.
    if (try body.hasNamedProperty("executionPayloadHeader")) return js.Boolean.from(false);

    const payload_js = try (try body.getNamedProperty("executionPayload")).coerceToObject();
    var payload: ct.bellatrix.ExecutionPayload.Type = ct.bellatrix.ExecutionPayload.default_value;
    defer ct.bellatrix.ExecutionPayload.deinit(allocator, &payload);
    try executionPayloadFromJs(allocator, payload_js, &payload);

    const is_default = ct.bellatrix.ExecutionPayload.equals(&payload, &ct.bellatrix.ExecutionPayload.default_value);
    return js.Boolean.from(!is_default);
}

/// Check if the merge transition is complete.
pub fn isMergeTransitionComplete(self: *BeaconStateView) !js.Boolean {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.isMergeTransitionComplete(f, cached_state.state.castToFork(f)),
    };
    return js.Boolean.from(result);
}

/// Get the proposer rewards for the state.
pub fn proposerRewards(self: *BeaconStateView) !js_types.ProposerRewards {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const rewards = cached_state.getProposerRewards();

    const obj = try env.createObject();
    try obj.setNamedProperty("attestations", js.Number.from(rewards.attestations).val);
    try obj.setNamedProperty("syncAggregate", js.Number.from(rewards.sync_aggregate).val);
    try obj.setNamedProperty("slashing", js.Number.from(rewards.slashing).val);
    return .{ .val = obj };
}

/// Populate a `SignedVoluntaryExit.Type` from a JS object of shape
/// `{message: {epoch, validatorIndex}, signature: Uint8Array(96)}`. Matches `phase0.SignedVoluntaryExit`
/// from `@lodestar/types`.
fn signedVoluntaryExitFromJsValue(value: js.Value, out: *ct.phase0.SignedVoluntaryExit.Type) !void {
    const raw = value.toValue();
    const message = try raw.getNamedProperty("message");
    out.message.epoch = try js_types.wrap(js.Number, try message.getNamedProperty("epoch")).toU64Exact();
    out.message.validator_index = try js_types.wrap(js.Number, try message.getNamedProperty("validatorIndex")).toU64Exact();

    const signature = try raw.getNamedProperty("signature");
    if (!(try signature.isTypedarray())) return error.SignatureNotTypedArray;
    const info = try signature.getTypedarrayInfo();
    if (info.array_type != .uint8) return error.SignatureNotUint8Array;
    if (info.data.len != out.signature.len) return error.InvalidSignatureLength;
    @memcpy(&out.signature, info.data);
}

pub fn getVoluntaryExitValidity(self: *BeaconStateView, signed_exit_value: js.Value, verify_signature_value: js.Boolean) !js.String {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const verify_signature = verify_signature_value.assertBool();

    var signed_voluntary_exit: ct.phase0.SignedVoluntaryExit.Type = ct.phase0.SignedVoluntaryExit.default_value;
    signedVoluntaryExitFromJsValue(signed_exit_value, &signed_voluntary_exit) catch {
        return throwNullAs(js.String, "INVALID_ARG", "Failed to read SignedVoluntaryExit from JS object");
    };

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.getVoluntaryExitValidity(
            f,
            js.io(),
            cached_state.config,
            cached_state.epoch_cache,
            cached_state.state.castToFork(f),
            &signed_voluntary_exit,
            verify_signature,
        ),
    };
    const validity = result catch {
        return throwNullAs(js.String, "VALIDATION_ERROR", "Failed to get voluntary exit validity");
    };

    return .{ .val = try env.createStringUtf8(@tagName(validity)) };
}

pub fn isValidVoluntaryExit(self: *BeaconStateView, signed_exit_value: js.Value, verify_signature_value: js.Boolean) !js.Boolean {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const verify_signature = verify_signature_value.assertBool();

    var signed_voluntary_exit: ct.phase0.SignedVoluntaryExit.Type = ct.phase0.SignedVoluntaryExit.default_value;
    signedVoluntaryExitFromJsValue(signed_exit_value, &signed_voluntary_exit) catch {
        return throwNullAs(js.Boolean, "INVALID_ARG", "Failed to read SignedVoluntaryExit from JS object");
    };

    const result = switch (cached_state.state.forkSeq()) {
        inline else => |f| st.isValidVoluntaryExit(
            f,
            js.io(),
            cached_state.config,
            cached_state.epoch_cache,
            cached_state.state.castToFork(f),
            &signed_voluntary_exit,
            verify_signature,
        ),
    };
    const is_valid = result catch {
        return throwNullAs(js.Boolean, "VALIDATION_ERROR", "Failed to validate voluntary exit");
    };

    return js.Boolean.from(is_valid);
}

pub fn getFinalizedRootProof(self: *BeaconStateView) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var proof = try cached_state.state.getFinalizedRootProof(allocator);
    defer proof.deinit(allocator);

    const witnesses = std.ArrayList([32]u8).fromOwnedSlice(proof.witnesses);
    return js_types.wrap(js.Array, try sszValueToNapiValue(
        env,
        ct.phase0.HistoricalRoots,
        &witnesses,
    ));
}

pub fn getSyncCommitteesWitness(self: *BeaconStateView) !js_types.SyncCommitteeWitness {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    try cached_state.state.commit();

    const fork_seq = cached_state.state.forkSeq();
    if (fork_seq.lt(.altair)) {
        return throwNullAs(
            js_types.SyncCommitteeWitness,
            "INVALID_FORK",
            "getSyncCommitteesWitness only supported altair+",
        );
    }

    const root_node = cached_state.state.root();
    var witness_data: st.SyncCommitteeWitness = undefined;
    try st.getSyncCommitteesWitness(fork_seq, root_node, cached_state.state.nodePool(), &witness_data);

    const witness_arr = try env.createArrayWithLength(@intCast(witness_data.witness_len));
    for (witness_data.witness(), 0..) |*w, i| {
        try witness_arr.setElement(@intCast(i), js.Uint8Array.from(w).toValue());
    }

    const obj = try env.createObject();
    try obj.setNamedProperty("witness", witness_arr);
    try obj.setNamedProperty(
        "currentSyncCommitteeRoot",
        js.Uint8Array.from(&witness_data.current_sync_committee_root).toValue(),
    );
    try obj.setNamedProperty(
        "nextSyncCommitteeRoot",
        js.Uint8Array.from(&witness_data.next_sync_committee_root).toValue(),
    );
    return js_types.wrap(js_types.SyncCommitteeWitness, obj);
}

/// Get a single Merkle proof  for a node at the given generalized index.
pub fn getSingleProof(self: *BeaconStateView, gindex_arg: js.BigInt) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    var lossless = false;
    const gindex = try gindex_arg.toU64(&lossless);
    if (!lossless) return error.InvalidGindex;

    var proof = cached_state.state.getSingleProof(allocator, gindex) catch {
        return throwNullAs(js.Array, "STATE_ERROR", "Failed to get single proof");
    };
    defer proof.deinit(allocator);

    const result = try env.createArray();
    for (proof.witnesses, 0..) |witness, i| {
        try result.setElement(@intCast(i), js.Uint8Array.from(&witness).toValue());
    }

    return .{ .val = result };
}

/// Create a compact multi-proof from a descriptor.
/// Returns: {type: string, leaves: Uint8Array[], descriptor: Uint8Array}
pub fn createMultiProof(self: *BeaconStateView, descriptor: js.Uint8Array) !js_types.MultiProof {
    const persistent_merkle_tree = @import("persistent_merkle_tree");
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const descriptor_bytes = try descriptor.toSlice();

    try cached_state.state.commit();
    const root_node = cached_state.state.root();

    const proof_input = persistent_merkle_tree.proof.ProofInput{
        .compactMulti = .{ .descriptor = descriptor_bytes },
    };

    var proof = persistent_merkle_tree.proof.createProof(
        allocator,
        cached_state.state.nodePool(),
        root_node,
        proof_input,
    ) catch {
        return throwNullAs(js_types.MultiProof, "STATE_ERROR", "Failed to create proof");
    };
    defer proof.deinit(allocator);

    const result = try env.createObject();
    const proof_type_str = switch (proof) {
        inline else => |_, tag| @tagName(tag),
    };
    try result.setNamedProperty("type", try env.createStringUtf8(proof_type_str));

    switch (proof) {
        .compactMulti => |compact| {
            const leaves_array = try env.createArray();
            for (compact.leaves, 0..) |leaf, i| {
                try leaves_array.setElement(@intCast(i), js.Uint8Array.from(&leaf).toValue());
            }
            try result.setNamedProperty("leaves", leaves_array);

            try result.setNamedProperty(
                "descriptor",
                js.Uint8Array.from(compact.descriptor).toValue(),
            );
        },
        else => return throwNullAs(js_types.MultiProof, "STATE_ERROR", "Unexpected proof type"),
    }

    return .{ .val = result };
}

pub fn computeUnrealizedCheckpoints(self: *BeaconStateView) !js_types.UnrealizedCheckpoints {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const result = try st.computeUnrealizedCheckpoints(allocator, cached_state);

    const obj = try env.createObject();
    try obj.setNamedProperty(
        "justifiedCheckpoint",
        try sszValueToNapiValue(env, ct.phase0.Checkpoint, &result.justified_checkpoint),
    );
    try obj.setNamedProperty(
        "finalizedCheckpoint",
        try sszValueToNapiValue(env, ct.phase0.Checkpoint, &result.finalized_checkpoint),
    );
    return .{ .val = obj };
}

pub fn clonedCount(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.Number.from(cached_state.cloned_count);
}

pub fn clonedCountWithTransferCache(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.Number.from(cached_state.cloned_count_with_transfer_cache);
}

pub fn createdWithTransferCache(self: *BeaconStateView) !js.Boolean {
    const cached_state = try self.acquireState();
    defer self.finishState();
    return js.Boolean.from(cached_state.created_with_transfer_cache);
}

/// Bench-only: run loadState end-to-end and tear down. Mirrors what TS's
/// loadState measures (no CachedBeaconState wrap, no EpochCache build) so
/// native vs TS comparisons isolate the SSZ tree-rebuild cost.
pub fn loadOtherStateBench(
    self: *BeaconStateView,
    state_bytes: js.Uint8Array,
    seed_validators_bytes: ?js.Uint8Array,
) !void {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const state_bytes_slice = try state_bytes.toSlice();
    _ = try stateBytesFork(cached_state.config, state_bytes_slice);
    const seed_validators_bytes_slice: ?[]const u8 =
        if (seed_validators_bytes) |b| try b.toSlice() else null;

    var result = try st.loadState(
        allocator,
        cached_state.config,
        cached_state.state,
        state_bytes_slice,
        seed_validators_bytes_slice,
    );
    allocator.free(result.modified_validators);
    result.state.deinit();
}

pub fn loadOtherState(
    self: *BeaconStateView,
    state_bytes: js.Uint8Array,
    seed_validators_bytes: ?js.Uint8Array,
    opts: ?js.Value,
) !BeaconStateView {
    const old_cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = old_cached_state.allocator;
    const state_bytes_slice = try state_bytes.toSlice();
    _ = try stateBytesFork(old_cached_state.config, state_bytes_slice);
    const seed_validators_bytes_slice: ?[]const u8 =
        if (seed_validators_bytes) |b| try b.toSlice() else null;

    var loaded = try st.loadState(
        allocator,
        old_cached_state.config,
        old_cached_state.state,
        state_bytes_slice,
        seed_validators_bytes_slice,
    );
    var loaded_state_moved = false;
    errdefer if (!loaded_state_moved) loaded.state.deinit();
    defer allocator.free(loaded.modified_validators);

    const new_state = try allocator.create(AnyBeaconState);
    var new_cached_state_initialized = false;
    errdefer if (!new_cached_state_initialized) {
        new_state.deinit();
        allocator.destroy(new_state);
    };
    new_state.* = loaded.state;
    loaded_state_moved = true;

    const new_cached_state = try allocator.create(CachedBeaconState);
    errdefer {
        if (new_cached_state_initialized) {
            new_cached_state.deinit();
        }
        allocator.destroy(new_cached_state);
    }

    const io = js.io();
    try initCachedState(allocator, new_cached_state, io, new_state, old_cached_state.config);
    new_cached_state_initialized = true;

    if (opts) |value| {
        const raw = value.toValue();
        if (try raw.hasNamedProperty("preloadValidatorsAndBalances") and
            (try (try raw.getNamedProperty("preloadValidatorsAndBalances")).getValueBool()))
        {
            //TODO(bing): These unnecessarily allocate and return memory that we throw away.
            // This doesn't matter for typescript lodestar because GC clears it anyway,
            // but we're losing some savings here. Consider implementating something like
            // a `prefetchAll` that only does `populateAllNodes` that returns void
            const validators_view = try new_cached_state.state.validators();
            const validators = validators_view.getAllReadonlyValues(allocator) catch |err| {
                try js.env().throwError("STATE_ERROR", "Failed to preload validators");
                return err;
            };
            allocator.free(validators);
            const balances_view = try new_cached_state.state.balances();
            const balances = balances_view.getAll(allocator) catch |err| {
                try js.env().throwError("STATE_ERROR", "Failed to preload balances");
                return err;
            };
            allocator.free(balances);
        }
    }

    return .{
        .cached_state = new_cached_state,
        .pool_rc = self.pool_rc.?.ref(),
        .config_rc = self.config_rc.?.ref(),
    };
}

pub fn serialize(self: *BeaconStateView) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const result = try cached_state.state.serialize(allocator);
    defer allocator.free(result);
    return .{ .val = try numberSliceToNapiValue(env, u8, result, .{ .typed_array = .uint8 }) };
}

pub fn serializedSize(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const size = switch (cached_state.state.*) {
        inline else => |state| try state.serializedSize(),
    };
    return js.Number.from(size);
}

/// Extract the writable `uint8Array` slice from a `@chainsafe/ssz` ByteViews object
/// `{uint8Array: Uint8Array, dataView: DataView}`. The `dataView` is ignored — Zig's
/// SSZ serializer only needs the raw bytes.
fn byteViewsToSlice(output: js.Value) ![]u8 {
    const arr_val = try output.toValue().getNamedProperty("uint8Array");
    const arr_info = try arr_val.getTypedarrayInfo();
    if (arr_info.array_type != .uint8) return error.InvalidByteViews;
    return arr_info.data;
}

/// arg 0: output: ByteViews `{uint8Array, dataView}` (matches IBeaconStateView contract)
/// arg 1: offset: offset of buffer where serialization should start
///
/// Returns the number of bytes written.
pub fn serializeToBytes(self: *BeaconStateView, output: js.Value, offset: js.Number) !js.Number {
    const output_slice = try byteViewsToSlice(output);
    const off: usize = try offset.toU64Exact();
    if (off > output_slice.len) return error.InvalidOffset;

    const cached_state = try self.acquireState();
    defer self.finishState();
    const bytes_written = switch (cached_state.state.*) {
        inline else => |state| try state.serializeIntoBytes(output_slice[off..]),
    };

    return js.Number.from(bytes_written);
}

pub fn serializeValidators(self: *BeaconStateView) !js.Uint8Array {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var validators_view = try cached_state.state.validators();

    const size = try validators_view.serializedSize();
    const result = try js.Uint8Array.alloc(size);
    _ = try validators_view.serializeIntoBytes(try result.toSlice());
    return result;
}

pub fn serializedValidatorsSize(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    var validators_view = try cached_state.state.validators();
    const size = try validators_view.serializedSize();
    return js.Number.from(size);
}

/// arg 0: output: ByteViews `{uint8Array, dataView}` (matches IBeaconStateView contract)
/// arg 1: offset: offset of buffer where serialization should start
///
/// Returns the number of bytes written.
pub fn serializeValidatorsToBytes(self: *BeaconStateView, output: js.Value, offset: js.Number) !js.Number {
    const output_slice = try byteViewsToSlice(output);
    const off: usize = try offset.toU64Exact();
    if (off > output_slice.len) return error.InvalidOffset;

    const cached_state = try self.acquireState();
    defer self.finishState();
    var validators_view = try cached_state.state.validators();
    const bytes_written = try validators_view.serializeIntoBytes(output_slice[off..]);
    return js.Number.from(bytes_written);
}

pub fn hashTreeRoot(self: *BeaconStateView) !js.Uint8Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const root = try cached_state.state.hashTreeRoot();
    return .{ .val = try numberSliceToNapiValue(env, u8, root, .{ .typed_array = .uint8 }) };
}

/// Process slots from current state slot to target slot, returning a new BeaconStateView.
///
/// Arguments:
/// - arg 0: target slot (number)
/// - arg 1: options object (optional) with Lodestar's `dontTransferCache` boolean
pub fn processSlots(self: *BeaconStateView, slot_arg: js.Number, options: ?js.Value) !BeaconStateView {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const slot_value = slot_arg.toU64Exact() catch return error.InvalidSlot;
    if (cached_state.config.forkSeq(slot_value).gte(.gloas)) return error.UnsupportedFork;

    var transfer_cache = true;
    if (options) |value| {
        const raw = value.toValue();
        if (try raw.typeof() == .object) {
            // TODO(bing): we should rename dontTransferCache to transferCache on TS-side to
            // avoid double negative, it's harder to read dontTransferCache = true versus
            // transferCache = false
            if (try raw.hasNamedProperty("dontTransferCache")) {
                transfer_cache = !(try (try raw.getNamedProperty("dontTransferCache")).getValueBool());
            } else if (try raw.hasNamedProperty("transferCache")) {
                transfer_cache = try (try raw.getNamedProperty("transferCache")).getValueBool();
            }
        }
    }
    const post_state = try cached_state.clone(allocator, .{ .transfer_cache = transfer_cache });
    errdefer {
        post_state.deinit();
        allocator.destroy(post_state);
    }
    st.metrics.state_transition.pre_state_cloned_count.observe(cached_state.cloned_count);

    try st.processSlots(
        allocator,
        js.io(),
        post_state,
        slot_value,
        validator_monitor.get(),
    );

    return .{
        .cached_state = post_state,
        .pool_rc = self.pool_rc.?.ref(),
        .config_rc = self.config_rc.?.ref(),
    };
}

/// Run the state transition on a SSZ-serialized SignedBeaconBlock, returning a new
/// BeaconStateView wrapping the post-state. Mirrors `IBeaconStateView.stateTransition`.
///
/// Arguments:
/// - arg 0: signed block bytes (Uint8Array)
/// - arg 1: whether the signed block is blinded (bool)
/// - arg 2: options (optional): parse `TransitionOpts`
pub fn stateTransition(
    self: *BeaconStateView,
    signed_block_bytes: js.Uint8Array,
    is_blinded: js.Boolean,
    options: ?js.Value,
) !BeaconStateView {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const opts = try @import("./transition_opts.zig").parseOptions(options);

    const bytes = try signed_block_bytes.toSlice();

    // SignedBeaconBlock has a four-byte message offset followed by a 96-byte signature.
    if (bytes.len < 108) return error.InvalidSignedBlockBytes;
    const offset = std.mem.readInt(u32, bytes[0..4], .little);
    if (offset != 100) return error.InvalidSignedBlockBytes;
    const block_slot = std.mem.readInt(u64, bytes[offset..][0..8], .little);
    const block_epoch = st.computeEpochAtSlot(block_slot);

    const fork_seq = cached_state.config.forkSeqAtEpoch(block_epoch);
    if (fork_seq.gte(.gloas)) return error.UnsupportedFork;

    const block_type: BlockType = if (try is_blinded.toBool()) .blinded else .full;
    const signed_block = try AnySignedBeaconBlock.deserialize(allocator, block_type, fork_seq, bytes);
    defer signed_block.deinit(allocator);

    const post_state = try st.stateTransition(
        allocator,
        js.io(),
        cached_state,
        signed_block,
        opts,
        validator_monitor.get(),
    );
    return .{
        .cached_state = post_state,
        .pool_rc = self.pool_rc.?.ref(),
        .config_rc = self.config_rc.?.ref(),
    };
}

/// Compute the anchor checkpoint and block header for the current state.
/// Returns: { checkpoint: { epoch, root }, blockHeader: BeaconBlockHeader }
pub fn computeAnchorCheckpoint(self: *BeaconStateView) !js.Value {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    var anchor = try st.AnchorCheckpoint.fromState(cached_state.state);

    const obj = try env.createObject();
    try obj.setNamedProperty(
        "checkpoint",
        try sszValueToNapiValue(env, ct.phase0.Checkpoint, &anchor.checkpoint),
    );
    try obj.setNamedProperty(
        "blockHeader",
        try sszValueToNapiValue(env, ct.phase0.BeaconBlockHeader, &anchor.block_header),
    );
    return js_types.wrap(js.Value, obj);
}

fn shufflingToNapi(shuffling: anytype) !napi.Value {
    const env = js.env();
    const obj = try env.createObject();
    try obj.setNamedProperty("epoch", try env.createInt64(@intCast(shuffling.epoch)));
    try obj.setNamedProperty(
        "activeIndices",
        try numberSliceToNapiValue(env, u64, shuffling.active_indices, .{ .typed_array = .uint32 }),
    );
    try obj.setNamedProperty(
        "shuffling",
        try numberSliceToNapiValue(env, u64, shuffling.shuffling, .{ .typed_array = .uint32 }),
    );

    const committees_outer = try env.createArray();
    for (shuffling.committees, 0..) |slot_committees, slot_idx| {
        const slot_arr = try env.createArray();
        for (slot_committees, 0..) |committee, committee_idx| {
            const committee_arr = try numberSliceToNapiValue(env, u64, committee, .{ .typed_array = .uint32 });
            try slot_arr.setElement(@intCast(committee_idx), committee_arr);
        }
        try committees_outer.setElement(@intCast(slot_idx), slot_arr);
    }
    try obj.setNamedProperty("committees", committees_outer);
    try obj.setNamedProperty("committeesPerSlot", try env.createInt64(@intCast(shuffling.committees_per_slot)));

    return obj;
}

pub fn getPreviousShuffling(self: *BeaconStateView) !js.Value {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const shuffling = cached_state.epoch_cache.getPreviousShuffling();
    return js_types.wrap(js.Value, try shufflingToNapi(shuffling));
}

pub fn getCurrentShuffling(self: *BeaconStateView) !js.Value {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const shuffling = cached_state.epoch_cache.getCurrentShuffling();
    return js_types.wrap(js.Value, try shufflingToNapi(shuffling));
}

pub fn getNextShuffling(self: *BeaconStateView) !js.Value {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const shuffling = cached_state.epoch_cache.getNextEpochShuffling();
    return js_types.wrap(js.Value, try shufflingToNapi(shuffling));
}

pub fn getBeaconCommittee(self: *BeaconStateView, slot_arg: js.Number, index: js.Number) !js.Uint32Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const slot_: u64 = try slot_arg.toU64Exact();
    const index_: u64 = try index.toU64Exact();

    const committee = try cached_state.epoch_cache.getBeaconCommittee(slot_, index_);
    return .{ .val = try numberSliceToNapiValue(env, u64, committee, .{ .typed_array = .uint32 }) };
}

pub fn getBeaconCommitteeCountPerSlot(self: *BeaconStateView, epoch_arg: js.Number) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_: u64 = try epoch_arg.toU64Exact();

    return js.Number.from(try cached_state.epoch_cache.getCommitteeCountPerSlot(epoch_));
}

pub fn getShufflingAtEpoch(self: *BeaconStateView, epoch_arg: js.Number) !js.Value {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const epoch_value: u64 = try epoch_arg.toU64Exact();

    const shuffling = cached_state.epoch_cache.getShufflingAtEpochOrNull(epoch_value) orelse {
        return throwNullAs(js.Value, "NO_SHUFFLING", "Shuffling not available for requested epoch");
    };
    return js_types.wrap(js.Value, try shufflingToNapi(shuffling));
}

// -------------------------
// Throw stubs — IBeaconStateView surface not yet implemented in lodestar-z
// -------------------------

fn throwNotImpl(comptime T: type, name: [:0]const u8) !T {
    return throwNullAs(T, "NOT_IMPLEMENTED", name);
}

// --- Gloas-only fields/methods (no Gloas state in lodestar-z yet) ---

pub fn latestBlockHash(_: *const BeaconStateView) !js.Uint8Array {
    return throwNotImpl(js.Uint8Array, "latestBlockHash is not available before Gloas");
}

pub fn executionPayloadAvailability(_: *const BeaconStateView) !js.Value {
    return throwNotImpl(js.Value, "executionPayloadAvailability is not available before Gloas");
}

pub fn latestExecutionPayloadBid(_: *const BeaconStateView) !js.Value {
    return throwNotImpl(js.Value, "latestExecutionPayloadBid is not available before Gloas");
}

pub fn payloadExpectedWithdrawals(_: *const BeaconStateView) !js.Array {
    return throwNotImpl(js.Array, "payloadExpectedWithdrawals is not available before Gloas");
}

pub fn getBuilder(_: *const BeaconStateView, _: js.Number) !js.Value {
    return throwNotImpl(js.Value, "getBuilder is not available before Gloas");
}

pub fn canBuilderCoverBid(_: *const BeaconStateView, _: js.Number, _: js.Number) !js.Boolean {
    return throwNotImpl(js.Boolean, "canBuilderCoverBid is not available before Gloas");
}

pub fn getEpochPTCs(_: *const BeaconStateView, _: js.Number) !js.Array {
    return throwNotImpl(js.Array, "getEpochPTCs is not available before Gloas");
}

pub fn getIndexInPayloadTimelinessCommittee(_: *const BeaconStateView, _: js.Number, _: js.Number) !js.Number {
    return throwNotImpl(js.Number, "getIndexInPayloadTimelinessCommittee is not available before Gloas");
}

pub fn getExpectedWithdrawalsForFullParent(_: *const BeaconStateView, _: js.Value) !js.Array {
    return throwNotImpl(js.Array, "getExpectedWithdrawalsForFullParent is not available before Gloas");
}

pub fn withParentPayloadApplied(_: *const BeaconStateView, _: js.Value) !BeaconStateView {
    try js.env().throwError("NOT_IMPLEMENTED", "withParentPayloadApplied is not available before Gloas");
    return error.NotImplemented;
}

// --- API-only methods (used by beacon-node rewards endpoints) ---

pub fn computeBlockRewards(
    self: *BeaconStateView,
    signed_block_bytes: js.Uint8Array,
    is_blinded: js.Boolean,
    proposer_rewards: ?js.Value,
) !js_types.BlockRewards {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const bytes = try signed_block_bytes.toSlice();

    const block_type: BlockType = if (try is_blinded.toBool()) .blinded else .full;
    const signed_block = try AnySignedBeaconBlock.deserialize(
        allocator,
        block_type,
        cached_state.state.forkSeq(),
        bytes,
    );
    defer signed_block.deinit(allocator);

    const cached = try parseProposerRewards(proposer_rewards);
    const rewards = try st.computeBlockRewardsAny(
        allocator,
        js.io(),
        cached_state,
        signed_block.beaconBlock(),
        cached,
    );

    const result = js_types.BlockRewards{ .val = try env.createObject() };
    try result.set(.{
        .proposerIndex = js.Number.from(rewards.proposer_index),
        .total = js.Number.from(rewards.total),
        .attestations = js.Number.from(rewards.attestations),
        .syncAggregate = js.Number.from(rewards.sync_aggregate),
        .proposerSlashings = js.Number.from(rewards.proposer_slashings),
        .attesterSlashings = js.Number.from(rewards.attester_slashings),
    });
    return result;
}

fn parseProposerRewards(value: ?js.Value) !?st.ProposerRewards {
    const raw = (value orelse return null).toValue();
    if (try raw.typeof() != .object) return null;
    return st.ProposerRewards{
        .attestations = try optionalU64(raw, "attestations"),
        .sync_aggregate = try optionalU64(raw, "syncAggregate"),
        .slashing = try optionalU64(raw, "slashing"),
    };
}

fn optionalU64(obj: napi.Value, name: [:0]const u8) !u64 {
    if (!try obj.hasNamedProperty(name)) return 0;
    return js_types.wrap(js.Number, try obj.getNamedProperty(name)).toU64Exact();
}

pub fn computeAttestationsRewards(self: *BeaconStateView, validator_ids: ?js.Value) !js_types.AttestationsRewards {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    if (cached_state.state.forkSeq() == .phase0) return error.AttestationsRewardsUnsupportedFork;
    const filters = try parseAttestationRewardFilters(allocator, validator_ids);
    defer if (filters) |indices| allocator.free(indices);
    const rewards = try st.computeAttestationsRewards(allocator, cached_state, filters);
    defer rewards.deinit(allocator);

    const env = js.env();
    const ideal = js.Array{ .val = try env.createArrayWithLength(rewards.ideal_rewards.len) };
    for (rewards.ideal_rewards, 0..) |reward, i| {
        const row = js_types.IdealAttestationsReward{ .val = try env.createObject() };
        try row.set(.{
            .effectiveBalance = js.Number.from(reward.effective_balance),
            .head = js.Number.from(reward.head),
            .target = js.Number.from(reward.target),
            .source = js.Number.from(reward.source),
            .inclusionDelay = js.Number.from(0),
            .inactivity = js.Number.from(0),
        });
        try ideal.set(@intCast(i), row);
    }
    const total = js.Array{ .val = try env.createArrayWithLength(rewards.total_rewards.len) };
    for (rewards.total_rewards, 0..) |reward, i| {
        const row = js_types.TotalAttestationsReward{ .val = try env.createObject() };
        try row.set(.{
            .validatorIndex = js.Number.from(reward.validator_index),
            .head = js.Number.from(reward.head),
            .target = js.Number.from(reward.target),
            .source = js.Number.from(reward.source),
            .inclusionDelay = js.Number.from(0),
            .inactivity = js.Number.from(reward.inactivity),
        });
        try total.set(@intCast(i), row);
    }
    const result = js_types.AttestationsRewards{ .val = try env.createObject() };
    try result.set(.{ .idealRewards = ideal, .totalRewards = total });
    return result;
}

fn parseAttestationRewardFilters(allocator: std.mem.Allocator, value: ?js.Value) !?[]u64 {
    const raw = (value orelse return null).val;
    const count = try raw.getArrayLength();
    if (count == 0) return null;
    var indices: std.ArrayList(u64) = .empty;
    errdefer indices.deinit(allocator);
    for (0..count) |i| {
        const id = try raw.getElement(@intCast(i));
        if (try id.typeof() == .number) {
            const index = js_types.wrap(js.Number, id).toU64Exact() catch |err| {
                if (err == error.InvalidUnsignedInteger) continue;
                return err;
            };
            try indices.append(allocator, index);
        } else {
            const string = js.String{ .val = id };
            const text = try string.toOwnedSlice(allocator);
            defer allocator.free(text);
            const hex = if (std.mem.startsWith(u8, text, "0x")) text[2..] else text;
            if (hex.len % 2 != 0) {
                var buffer: [96]u8 = undefined;
                const message = try std.fmt.bufPrintZ(&buffer, "hex string length {d} must be multiple of 2", .{hex.len});
                try js.env().throwError("INVALID_ARGUMENT", message);
                return error.InvalidPubkeyHex;
            }
            for (hex) |char| {
                if (!std.ascii.isHex(char)) {
                    try js.env().throwError("INVALID_ARGUMENT", "hex string contains invalid characters");
                    return error.InvalidPubkeyHex;
                }
            }
            if (hex.len != 96) return error.InvalidPubkeyLength;
            var key: [48]u8 = undefined;
            _ = try std.fmt.hexToBytes(&key, hex);
            if (pubkey.state.cache.get(js.io(), key)) |index| try indices.append(allocator, index);
        }
    }
    std.mem.sort(u64, indices.items, {}, std.sort.asc(u64));
    return try indices.toOwnedSlice(allocator);
}

pub fn computeSyncCommitteeRewards(self: *BeaconStateView, block: js.Value, validator_ids: ?js.Value) !js.Array {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const slot_number = js_types.wrap(js.Number, try block.val.getNamedProperty("slot"));
    const block_slot = slot_number.toU64Exact() catch |err| {
        if (err == error.InvalidUnsignedInteger) return error.InvalidSlot;
        return err;
    };
    if (cached_state.config.forkSeq(block_slot) == .phase0) return error.SyncCommitteeRewardsUnsupportedFork;
    const body = try block.val.getNamedProperty("body");
    const aggregate = try body.getNamedProperty("syncAggregate");
    const bits = try aggregate.getNamedProperty("syncCommitteeBits");
    const bit_len = js_types.wrap(js.Number, try bits.getNamedProperty("bitLen")).toU32Exact() catch |err| {
        if (err == error.InvalidUnsignedInteger) return error.InvalidSyncCommitteeBitsLength;
        return err;
    };
    if (bit_len != preset.SYNC_COMMITTEE_SIZE) return error.InvalidSyncCommitteeBitsLength;
    var sync_aggregate: ct.altair.SyncAggregate.Type = undefined;
    // Copy before subsequent JS getters can detach or resize the backing buffer.
    try readByteArrayInto(bits, "uint8Array", &sync_aggregate.sync_committee_bits.data);
    const filters = try parseSyncRewardFilters(allocator, validator_ids);
    defer if (filters) |indices| allocator.free(indices);

    const rewards = try st.computeSyncCommitteeRewards(allocator, cached_state, &sync_aggregate);
    defer allocator.free(rewards);

    const result = js.Array{ .val = try env.createArray() };
    var output_index: u32 = 0;
    for (rewards) |reward| {
        if (filters) |indices| {
            if (std.mem.findScalar(u64, indices, reward.validator_index) == null) continue;
        }
        const row = js_types.SyncCommitteeReward{ .val = try env.createObject() };
        try row.set(.{
            .validatorIndex = js.Number.from(reward.validator_index),
            .reward = js.Number.from(reward.reward),
        });
        try result.set(output_index, row);
        output_index += 1;
    }
    return result;
}

fn parseSyncRewardFilters(allocator: std.mem.Allocator, value: ?js.Value) !?[]u64 {
    const raw = (value orelse return null).val;
    const count = try raw.getArrayLength();
    if (count == 0) return null;
    var indices: std.ArrayList(u64) = .empty;
    errdefer indices.deinit(allocator);
    for (0..count) |i| {
        const id = try raw.getElement(@intCast(i));
        switch (try id.typeof()) {
            .number => {
                const index = js_types.wrap(js.Number, id).toU64Exact() catch |err| {
                    if (err == error.InvalidUnsignedInteger) continue;
                    return err;
                };
                try indices.append(allocator, index);
            },
            .string => {
                const string = js.String{ .val = id };
                if (try string.len() != 98) continue;
                var buffer: [99]u8 = undefined;
                const hex = try string.toSlice(&buffer);
                if (!std.mem.startsWith(u8, hex, "0x")) continue;
                var canonical = true;
                for (hex[2..]) |char| {
                    if (!std.ascii.isDigit(char) and !(char >= 'a' and char <= 'f')) {
                        canonical = false;
                        break;
                    }
                }
                if (!canonical) continue;
                var key: [48]u8 = undefined;
                _ = try std.fmt.hexToBytes(&key, hex[2..]);
                if (pubkey.state.cache.get(js.io(), key)) |index| try indices.append(allocator, index);
            },
            else => {},
        }
    }
    return try indices.toOwnedSlice(allocator);
}

// --- Misc not-yet-implemented ---

pub fn getLatestWeakSubjectivityCheckpointEpoch(self: *BeaconStateView) !js.Number {
    const cached_state = try self.acquireState();
    defer self.finishState();
    const ws_epoch = st.getLatestWeakSubjectivityCheckpointEpoch(cached_state.epoch_cache);
    return js.Number.from(ws_epoch);
}

pub fn isStateValidatorsNodesPopulated(_: *const BeaconStateView) !js.Boolean {
    // Native state is always fully populated — return true.
    return js.Boolean.from(true);
}

pub fn toValue(self: *BeaconStateView) !js.Value {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    switch (cached_state.state.forkSeq()) {
        inline else => |f| {
            const ForkBeaconState = fork_types.ForkTypes(f).BeaconState;
            const value = try allocator.create(ForkBeaconState.Type);
            defer allocator.destroy(value);
            value.* = ForkBeaconState.default_value;
            defer ForkBeaconState.deinit(allocator, value);
            try cached_state.state.castToFork(f).inner.toValue(allocator, value);
            return js_types.wrap(js.Value, try sszValueToNapiValue(env, ForkBeaconState, value));
        },
    }
}

/// Compute expected withdrawals for the next payload (capella+).
/// Returns: { expectedWithdrawals: Withdrawal[], processedPartialWithdrawalsCount, processedValidatorSweepCount,
///           processedBuilderWithdrawalsCount, processedBuildersSweepCount }
/// The latter two are Gloas-only — always 0 here since Zig STF doesn't process Gloas yet.
pub fn getExpectedWithdrawals(self: *BeaconStateView) !js.Value {
    const env = js.env();
    const cached_state = try self.acquireState();
    defer self.finishState();
    const allocator = cached_state.allocator;
    const fork_seq = cached_state.state.forkSeq();

    // We also check this within the native fn itself but this lets us avoid allocating an `AutoHashMap` early.
    if (fork_seq.lt(.capella)) {
        return throwNullAs(js.Value, "INVALID_FORK", "getExpectedWithdrawals only supported capella+");
    }

    var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]ct.capella.Withdrawal.Type = undefined;
    var withdrawals_result = st.WithdrawalsResult{
        .withdrawals = ct.capella.Withdrawals.Type.initBuffer(&withdrawals_buf),
    };

    var withdrawal_balances = std.AutoHashMap(ct.primitive.ValidatorIndex.Type, usize).init(allocator);
    defer withdrawal_balances.deinit();

    switch (fork_seq) {
        inline .capella, .deneb, .electra, .fulu => |f| {
            try st.getExpectedWithdrawals(
                f,
                cached_state.epoch_cache,
                cached_state.state.castToFork(f),
                &withdrawals_result,
                &withdrawal_balances,
            );
        },
        else => unreachable,
    }

    const obj = try env.createObject();

    const withdrawals_arr = try env.createArray();
    for (withdrawals_result.withdrawals.items, 0..) |*w, i| {
        const w_value = try sszValueToNapiValue(env, ct.capella.Withdrawal, w);
        try withdrawals_arr.setElement(@intCast(i), w_value);
    }
    try obj.setNamedProperty("expectedWithdrawals", withdrawals_arr);
    try obj.setNamedProperty("processedPartialWithdrawalsCount", try env.createUint32(@intCast(withdrawals_result.processed_partial_withdrawals_count)));
    try obj.setNamedProperty("processedValidatorSweepCount", try env.createUint32(@intCast(withdrawals_result.sampled_validators)));
    // TODO(bing): Implement when we support Gloas.
    try obj.setNamedProperty("processedBuilderWithdrawalsCount", try env.createUint32(0));
    try obj.setNamedProperty("processedBuildersSweepCount", try env.createUint32(0));

    return js_types.wrap(js.Value, obj);
}

// JavaScript getters and output setters can release a view while a native call borrows it.
// Keep its resources alive through every call's deferred cleanup, including error paths.
fn acquireState(self: *BeaconStateView) !*CachedBeaconState {
    if (self.release_requested) return error.InvalidState;
    const cached_state = self.cached_state orelse return error.InvalidState;
    self.active_calls = std.math.add(u32, self.active_calls, 1) catch return error.StateCallDepthExceeded;
    return cached_state;
}

fn finishState(self: *BeaconStateView) void {
    std.debug.assert(self.active_calls > 0);
    // Getters can allocate cached views; report while the active-call guard still holds.
    self.pool_rc.?.instance.reportMemory();
    self.active_calls -= 1;
    if (self.active_calls == 0 and self.release_requested) self.deinit();
}

fn jsNull() !js.Value {
    return js_types.wrap(js.Value, try js.env().getNull());
}

fn jsNullAs(comptime T: type) !T {
    return js_types.wrap(T, try js.env().getNull());
}

fn throwNull(code: [:0]const u8, message: [:0]const u8) !js.Value {
    const env = js.env();
    try env.throwError(code, message);
    return jsNull();
}

fn throwNullAs(comptime T: type, code: [:0]const u8, message: [:0]const u8) !T {
    const env = js.env();
    try env.throwError(code, message);
    return jsNullAs(T);
}

fn optionalBool(options: ?js.Value, name: [:0]const u8, default_value: bool) !bool {
    if (options) |value| {
        const raw = value.toValue();
        if (try raw.typeof() == .object) {
            if (try raw.hasNamedProperty(name)) {
                return try (try raw.getNamedProperty(name)).getValueBool();
            }
        }
    }
    return default_value;
}

/// Populate a native Bellatrix `ExecutionPayload.Type` from a JS object with the Lodestar
/// shape. Caller must `ct.bellatrix.ExecutionPayload.deinit(allocator, out)` to free
/// `extra_data` and `transactions`.
fn executionPayloadFromJs(allocator: std.mem.Allocator, payload: napi.Value, out: *ct.bellatrix.ExecutionPayload.Type) !void {
    try readByteArrayInto(payload, "parentHash", &out.parent_hash);
    try readByteArrayInto(payload, "feeRecipient", &out.fee_recipient);
    try readByteArrayInto(payload, "stateRoot", &out.state_root);
    try readByteArrayInto(payload, "receiptsRoot", &out.receipts_root);
    try readByteArrayInto(payload, "logsBloom", &out.logs_bloom);
    try readByteArrayInto(payload, "prevRandao", &out.prev_randao);
    try readByteArrayInto(payload, "blockHash", &out.block_hash);

    out.block_number = try js_types.wrap(js.Number, try payload.getNamedProperty("blockNumber")).toU64Exact();
    out.gas_limit = try js_types.wrap(js.Number, try payload.getNamedProperty("gasLimit")).toU64Exact();
    out.gas_used = try js_types.wrap(js.Number, try payload.getNamedProperty("gasUsed")).toU64Exact();
    out.timestamp = try js_types.wrap(js.Number, try payload.getNamedProperty("timestamp")).toU64Exact();

    out.base_fee_per_gas = try readBigintU256(try payload.getNamedProperty("baseFeePerGas"));

    const extra_data = try payload.getNamedProperty("extraData");
    const extra_data_info = try extra_data.getTypedarrayInfo();
    if (extra_data_info.array_type != .uint8) return error.InvalidExtraData;
    try out.extra_data.appendSlice(allocator, extra_data_info.data);

    const transactions = try payload.getNamedProperty("transactions");
    const tx_count = try transactions.getArrayLength();
    try out.transactions.ensureTotalCapacity(allocator, tx_count);
    var i: u32 = 0;
    while (i < tx_count) : (i += 1) {
        const tx_value = try transactions.getElement(i);
        const tx_info = try tx_value.getTypedarrayInfo();
        if (tx_info.array_type != .uint8) return error.InvalidTransaction;
        var tx: std.ArrayList(u8) = .empty;
        errdefer tx.deinit(allocator);
        try tx.appendSlice(allocator, tx_info.data);
        out.transactions.appendAssumeCapacity(tx);
    }
}

fn readByteArrayInto(parent: napi.Value, comptime field: [:0]const u8, out: []u8) !void {
    const value = try parent.getNamedProperty(field);
    const info = try value.getTypedarrayInfo();
    if (info.array_type != .uint8) return error.InvalidByteArrayField;
    if (info.data.len != out.len) return error.InvalidByteArrayLength;
    @memcpy(out, info.data);
}

/// Read a JS bigint into u256.
///
/// Throws on negative values; we never store signed u256 in consensus types.
fn readBigintU256(value: napi.Value) !u256 {
    var sign_bit: c_int = 0;
    var word_count: usize = 4;
    var words: [4]u64 = .{ 0, 0, 0, 0 };
    try napi.status.check(napi.c.napi_get_value_bigint_words(
        value.env,
        value.value,
        &sign_bit,
        &word_count,
        &words,
    ));
    if (sign_bit != 0) return error.NegativeBigint;
    var result: u256 = 0;
    var i: usize = 0;
    while (i < @min(word_count, 4)) : (i += 1) {
        result |= @as(u256, words[i]) << @intCast(i * 64);
    }
    return result;
}
