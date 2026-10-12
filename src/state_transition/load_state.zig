const std = @import("std");
const Allocator = std.mem.Allocator;

const types = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const ForkTypes = @import("fork_types").ForkTypes;

const ssz_bytes = @import("ssz_bytes.zig");
const ssz_container = @import("ssz_container.zig");

const ValidatorIndex = types.primitive.ValidatorIndex.Type;

/// Inactivity score is `uint64` (8 bytes).
const INACTIVITY_SCORE_SIZE: usize = types.primitive.Uint64.fixed_size;

// BeaconState field indices are stable across forks.
const BEACON_STATE_VALIDATORS_FIELD_INDEX: usize = types.phase0.BeaconState.getFieldIndex("validators");
const BEACON_STATE_INACTIVITY_SCORES_FIELD_INDEX: usize = types.altair.BeaconState.getFieldIndex("inactivity_scores");

pub const MigrateStateOutput = struct {
    state: AnyBeaconState,
    modified_validators: []ValidatorIndex,
};

/// Load BeaconState from SSZ bytes using a seed state to reuse unchanged subtrees.
///
/// This avoids full deserialization for large fields (validators/inactivity_scores)
/// by diffing bytes and reusing the seed state's TreeView nodes.
///
/// Returns the migrated state and indices of modified validators.
///
/// Errors are propagated from SSZ parsing and tree operations when bytes are invalid.
pub fn loadState(
    allocator: Allocator,
    config: *const BeaconConfig,
    seed_state: *AnyBeaconState,
    state_bytes: []const u8,
    seed_validators_bytes: ?[]const u8,
) !MigrateStateOutput {
    const fork = try ssz_bytes.getForkFromStateBytes(config, state_bytes);
    const seed_fork = config.forkSeq(try seed_state.slot());
    const pool = seed_state.nodePool();

    return switch (fork) {
        inline else => |f| try loadStateForFork(allocator, pool, f, seed_fork, seed_state, ForkTypes(f).BeaconState, state_bytes, seed_validators_bytes),
    };
}

fn deserializeBeaconStateTreeViewWithSeedOverrides(
    allocator: Allocator,
    pool: *Node.Pool,
    comptime out_fork: ForkSeq,
    seed_fork: ForkSeq,
    seed_state: *AnyBeaconState,
    comptime StateST: type,
    state_bytes: []const u8,
    ranges: *const [StateST.fields.len][2]usize,
    seed_validators_node: Node.Id,
) !*StateST.TreeView {
    if (comptime out_fork.gte(.altair)) {
        // If the seed fork is pre-altair, there are no scores to reuse, so the container
        // deserializes inactivity_scores (diff optimization only applies when seed_fork >= altair).
        if (seed_fork.gte(.altair)) {
            const scores_node = try inactivityScoresNodeId(seed_state);
            return try ssz_container.deserializeContainerOverrideFieldsWithRanges(
                allocator,
                pool,
                StateST,
                state_bytes,
                ranges,
                .{ .validators = seed_validators_node, .inactivity_scores = scores_node },
            );
        }
    }

    return try ssz_container.deserializeContainerOverrideFieldsWithRanges(
        allocator,
        pool,
        StateST,
        state_bytes,
        ranges,
        .{ .validators = seed_validators_node },
    );
}

fn loadStateForFork(
    allocator: Allocator,
    pool: *Node.Pool,
    comptime out_fork: ForkSeq,
    seed_fork: ForkSeq,
    seed_state: *AnyBeaconState,
    comptime StateST: type,
    state_bytes: []const u8,
    seed_validators_bytes: ?[]const u8,
) !MigrateStateOutput {
    const ranges = try StateST.readFieldRanges(state_bytes);

    const validators_field_index = comptime StateST.getFieldIndex("validators");

    const seed_validators_node = try validatorsNodeId(seed_state);

    const migrated_view = try deserializeBeaconStateTreeViewWithSeedOverrides(
        allocator,
        pool,
        out_fork,
        seed_fork,
        seed_state,
        StateST,
        state_bytes,
        &ranges,
        seed_validators_node,
    );
    errdefer migrated_view.deinit();

    const validators_range = ranges[validators_field_index];
    const new_validators_bytes = state_bytes[validators_range[0]..validators_range[1]];
    const modified_validators = try loadValidators(allocator, StateST, migrated_view, pool, seed_validators_node, new_validators_bytes, seed_validators_bytes);
    errdefer allocator.free(modified_validators);

    if (comptime out_fork.gte(.altair)) {
        if (seed_fork.gte(.altair)) {
            const scores_field_index = comptime StateST.getFieldIndex("inactivity_scores");
            const scores_range = ranges[scores_field_index];
            const inactivity_scores_bytes = state_bytes[scores_range[0]..scores_range[1]];
            const seed_scores_node = try inactivityScoresNodeId(seed_state);
            try loadInactivityScores(allocator, StateST, migrated_view, pool, seed_scores_node, inactivity_scores_bytes);
        }
    }

    try migrated_view.commit();

    const migrated_state = @unionInit(AnyBeaconState, @tagName(out_fork), migrated_view);
    return .{ .state = migrated_state, .modified_validators = modified_validators };
}

/// Migrate the `inactivity_scores` list onto `migrated_view`, reusing the seed's subtree.
///
/// Inactivity scores rarely change between two states (mostly 0 on mainnet), so reusing
/// the seed's unchanged score subtrees saves ~500ms of state hashTreeRoot time.
fn loadInactivityScores(
    allocator: Allocator,
    comptime StateST: type,
    migrated_view: *StateST.TreeView,
    pool: *Node.Pool,
    seed_scores_node: Node.Id,
    inactivity_scores_bytes: []const u8,
) !void {
    if (inactivity_scores_bytes.len % INACTIVITY_SCORE_SIZE != 0) return error.InvalidSize;

    const seed_scores = try types.altair.InactivityScores.TreeView.init(allocator, pool, seed_scores_node);
    defer seed_scores.deinit();

    var migrated_scores = try seed_scores.clone(.{ .transfer_cache = false });
    errdefer migrated_scores.deinit();

    const diff_ctx = try buildScoresDiffContext(allocator, migrated_scores, inactivity_scores_bytes);
    defer allocator.free(diff_ctx.old_bytes);

    var modified_validators: std.ArrayList(ValidatorIndex) = .empty;
    defer modified_validators.deinit(allocator);

    const old_scores_slice = if (diff_ctx.has_more_validators)
        diff_ctx.old_bytes
    else
        diff_ctx.old_bytes[0 .. diff_ctx.min_validator_count * INACTIVITY_SCORE_SIZE];
    const new_scores_slice = if (diff_ctx.has_more_validators)
        inactivity_scores_bytes[0 .. diff_ctx.min_validator_count * INACTIVITY_SCORE_SIZE]
    else
        inactivity_scores_bytes;

    try findModifiedIndices(
        INACTIVITY_SCORE_SIZE,
        allocator,
        old_scores_slice,
        new_scores_slice,
        &modified_validators,
    );
    try applyScoreDiffs(migrated_scores, inactivity_scores_bytes, modified_validators.items);
    migrated_scores = try syncScoresLength(allocator, migrated_scores, inactivity_scores_bytes, diff_ctx.old_validator_count, diff_ctx.new_validator_count);

    try migrated_view.set("inactivity_scores", migrated_scores);
}

/// Migrate the `validators` list onto `migrated_view`, reusing the seed's subtree
/// for unchanged validators and deserializing only the modified ones.
///
/// Returns the absolute indices of validators that differ from the seed (caller owns the slice).
fn loadValidators(
    allocator: Allocator,
    comptime StateST: type,
    migrated_view: *StateST.TreeView,
    pool: *Node.Pool,
    seed_validators_node: Node.Id,
    new_validators_bytes: []const u8,
    seed_state_validators_bytes: ?[]const u8,
) ![]ValidatorIndex {
    if (new_validators_bytes.len % types.phase0.Validator.fixed_size != 0) return error.InvalidSize;
    if (seed_state_validators_bytes) |bytes| {
        if (bytes.len % types.phase0.Validator.fixed_size != 0) return error.InvalidSize;
    }

    const seed_validators = try types.phase0.Validators.TreeView.init(allocator, pool, seed_validators_node);
    defer seed_validators.deinit();

    const seed_count = try seed_validators.length();
    const new_count = new_validators_bytes.len / types.phase0.Validator.fixed_size;
    const min_count = @min(seed_count, new_count);
    if (seed_state_validators_bytes) |bytes| {
        if (bytes.len / types.phase0.Validator.fixed_size < min_count) return error.InvalidSize;
    }

    var migrated_validators = try seed_validators.clone(.{ .transfer_cache = false });
    errdefer migrated_validators.deinit();

    // Only set when we serialize the seed ourselves; the cleanup frees exactly that case.
    var serialized_seed: ?[]u8 = null;
    defer if (serialized_seed) |bytes| allocator.free(bytes);

    // 80% of validators serialization time comes from memory allocation.
    // seed_state_validators_bytes is an optimization at the beacon-node side to avoid
    // memory allocation here.
    const seed_bytes: []const u8 = seed_state_validators_bytes orelse blk: {
        const size = try seed_validators.serializedSize();
        const out = try allocator.alloc(u8, size);
        serialized_seed = out;
        _ = try seed_validators.serializeIntoBytes(out);
        break :blk out;
    };

    var modified_validators: std.ArrayList(ValidatorIndex) = .empty;
    errdefer modified_validators.deinit(allocator);

    const old_validators_slice = seed_bytes[0 .. min_count * types.phase0.Validator.fixed_size];
    const new_validators_slice = new_validators_bytes[0 .. min_count * types.phase0.Validator.fixed_size];
    try findModifiedIndices(
        types.phase0.Validator.fixed_size,
        allocator,
        old_validators_slice,
        new_validators_slice,
        &modified_validators,
    );

    try applyModifiedValidators(
        allocator,
        migrated_validators,
        new_validators_bytes,
        modified_validators.items,
    );

    if (new_count >= seed_count) {
        const extra_count = new_count - seed_count;
        try modified_validators.ensureUnusedCapacity(allocator, extra_count);

        try appendNewValidators(allocator, migrated_validators, new_validators_bytes, seed_count, new_count, &modified_validators);
    } else {
        migrated_validators = try trimValidators(allocator, migrated_validators, new_count);
    }

    const out_slice = try modified_validators.toOwnedSlice(allocator);
    errdefer allocator.free(out_slice);

    try migrated_view.set("validators", migrated_validators);
    return out_slice;
}

const ScoresDiffContext = struct {
    old_bytes: []u8,
    has_more_validators: bool,
    min_validator_count: usize,
    old_validator_count: usize,
    new_validator_count: usize,
};

/// Snapshot the seed scores (serialized bytes plus counts) needed to diff against the new bytes.
fn buildScoresDiffContext(
    allocator: Allocator,
    migrated_scores: *types.altair.InactivityScores.TreeView,
    inactivity_scores_bytes: []const u8,
) !ScoresDiffContext {
    const old_validator_count = try migrated_scores.length();
    const new_validator_count = inactivity_scores_bytes.len / INACTIVITY_SCORE_SIZE;
    const has_more_validators = new_validator_count >= old_validator_count;
    const min_validator_count = @min(old_validator_count, new_validator_count);

    const old_size = try migrated_scores.serializedSize();
    const old_bytes = try allocator.alloc(u8, old_size);
    errdefer allocator.free(old_bytes);

    _ = try migrated_scores.serializeIntoBytes(old_bytes);

    return .{
        .old_bytes = old_bytes,
        .has_more_validators = has_more_validators,
        .min_validator_count = min_validator_count,
        .old_validator_count = old_validator_count,
        .new_validator_count = new_validator_count,
    };
}

/// Write each modified inactivity score into `migrated_scores` from `inactivity_scores_bytes`.
fn applyScoreDiffs(
    migrated_scores: *types.altair.InactivityScores.TreeView,
    inactivity_scores_bytes: []const u8,
    modified_validators: []const ValidatorIndex,
) !void {
    for (modified_validators) |validator_index| {
        const i: usize = @intCast(validator_index);
        const start = i * INACTIVITY_SCORE_SIZE;
        const chunk: *const [INACTIVITY_SCORE_SIZE]u8 = @ptrCast(inactivity_scores_bytes[start .. start + INACTIVITY_SCORE_SIZE].ptr);
        const value = std.mem.readInt(u64, chunk, .little);
        try migrated_scores.set(i, value);
    }
}

/// Resize `migrated_scores` to `new_validator_count`: append new scores when growing,
/// or return a trimmed (or empty) view when shrinking. Returns the resulting view.
fn syncScoresLength(
    allocator: Allocator,
    migrated_scores: *types.altair.InactivityScores.TreeView,
    inactivity_scores_bytes: []const u8,
    old_validator_count: usize,
    new_validator_count: usize,
) !*types.altair.InactivityScores.TreeView {
    if (new_validator_count >= old_validator_count) {
        var idx: usize = old_validator_count;
        while (idx < new_validator_count) : (idx += 1) {
            const start = idx * INACTIVITY_SCORE_SIZE;
            const chunk: *const [INACTIVITY_SCORE_SIZE]u8 = @ptrCast(inactivity_scores_bytes[start .. start + INACTIVITY_SCORE_SIZE].ptr);
            const value = std.mem.readInt(u64, chunk, .little);
            try migrated_scores.push(value);
        }
        return migrated_scores;
    }

    if (new_validator_count == 0) {
        const pool = migrated_scores.chunks.state.pool;
        const empty_root = try types.altair.InactivityScores.tree.fromValue(
            pool,
            &types.altair.InactivityScores.default_value,
        );
        errdefer pool.unref(empty_root);

        const empty_scores = try types.altair.InactivityScores.TreeView.init(allocator, pool, empty_root);
        migrated_scores.deinit();
        return empty_scores;
    }

    const trimmed = try migrated_scores.sliceTo(new_validator_count - 1);
    migrated_scores.deinit();
    return trimmed;
}

/// Overwrite each modified validator in `migrated_validators` with a view
/// freshly deserialized from `new_validators_bytes`.
fn applyModifiedValidators(
    allocator: Allocator,
    migrated_validators: *types.phase0.Validators.TreeView,
    new_validators_bytes: []const u8,
    modified_validators: []const ValidatorIndex,
) !void {
    for (modified_validators) |validator_index| {
        const i: usize = @intCast(validator_index);
        const start = i * types.phase0.Validator.fixed_size;
        const new_bytes = new_validators_bytes[start .. start + types.phase0.Validator.fixed_size];

        const new_validator = try loadValidator(
            allocator,
            migrated_validators.chunks.state.pool,
            new_bytes,
        );
        errdefer new_validator.deinit();

        try migrated_validators.set(i, new_validator);
    }
}

/// Deserialize and push validators at indices [start_index, end_index) from
/// `new_validators_bytes`, recording each appended index in `modified_validators`.
fn appendNewValidators(
    allocator: Allocator,
    migrated_validators: *types.phase0.Validators.TreeView,
    new_validators_bytes: []const u8,
    start_index: usize,
    end_index: usize,
    modified_validators: *std.ArrayList(ValidatorIndex),
) !void {
    var idx: usize = start_index;
    while (idx < end_index) : (idx += 1) {
        const start = idx * types.phase0.Validator.fixed_size;
        const new_bytes = new_validators_bytes[start .. start + types.phase0.Validator.fixed_size];

        const pool = migrated_validators.chunks.state.pool;
        var v: ?*types.phase0.Validator.TreeView = blk: {
            const root = try types.phase0.Validator.tree.deserializeFromBytes(pool, new_bytes);
            errdefer pool.unref(root);

            break :blk try types.phase0.Validator.TreeView.init(allocator, pool, root);
        };
        errdefer if (v) |vv| vv.deinit();

        try migrated_validators.push(v.?);
        v = null;
        modified_validators.appendAssumeCapacity(@intCast(idx));
    }
}

/// Shrink `migrated_validators` to `new_count`, returning a trimmed (or empty) view.
fn trimValidators(
    allocator: Allocator,
    migrated_validators: *types.phase0.Validators.TreeView,
    new_count: usize,
) !*types.phase0.Validators.TreeView {
    if (new_count == 0) {
        const pool = migrated_validators.chunks.state.pool;
        const empty_root = try types.phase0.Validators.tree.fromValue(
            pool,
            &types.phase0.Validators.default_value,
        );
        errdefer pool.unref(empty_root);

        const empty_validators = try types.phase0.Validators.TreeView.init(allocator, pool, empty_root);
        migrated_validators.deinit();
        return empty_validators;
    }

    const trimmed = try migrated_validators.sliceTo(new_count - 1);
    migrated_validators.deinit();
    return trimmed;
}

fn validatorsNodeId(state: *AnyBeaconState) !Node.Id {
    return switch (state.*) {
        inline else => |s| s.root.getNodeAtDepth(s.pool, @TypeOf(s.*).SszType.chunk_depth, BEACON_STATE_VALIDATORS_FIELD_INDEX),
    };
}

fn inactivityScoresNodeId(state: *AnyBeaconState) !Node.Id {
    return switch (state.*) {
        .phase0 => error.InvalidAtFork,
        inline else => |s| s.root.getNodeAtDepth(s.pool, @TypeOf(s.*).SszType.chunk_depth, BEACON_STATE_INACTIVITY_SCORES_FIELD_INDEX),
    };
}

/// Deserialize a validator from `new_validator_bytes` into a fresh TreeView.
/// No seed/field reuse: `Validator` is a `StructContainerType` (one opaque
/// node, fields inline by value) — there are no per-field subtrees to share.
fn loadValidator(
    allocator: Allocator,
    pool: *Node.Pool,
    new_validator_bytes: []const u8,
) !*types.phase0.Validator.TreeView {
    const root = try types.phase0.Validator.tree.deserializeFromBytes(pool, new_validator_bytes);
    errdefer pool.unref(root);

    return try types.phase0.Validator.TreeView.init(allocator, pool, root);
}

/// Appends, in ascending order, the indices of `element_size`-byte elements that differ
/// between two equal-length slices.
fn findModifiedIndices(
    comptime element_size: usize,
    allocator: Allocator,
    old_bytes: []const u8,
    new_bytes: []const u8,
    modified: *std.ArrayList(ValidatorIndex),
) !void {
    std.debug.assert(old_bytes.len == new_bytes.len);
    std.debug.assert(old_bytes.len % element_size == 0);

    // One wide comparison keeps the common unchanged case on the vectorized path.
    if (std.mem.eql(u8, old_bytes, new_bytes)) return;

    for (0..old_bytes.len / element_size) |index| {
        const start = index * element_size;
        const old = old_bytes[start..][0..element_size];
        const new = new_bytes[start..][0..element_size];
        if (!std.mem.eql(u8, old, new)) try modified.append(allocator, @intCast(index));
    }
}

test "loadState scenarios" {
    const allocator = std.testing.allocator;
    const gen = @import("test_utils/generate_state.zig");
    const chain_config = gen.getConfig(@import("config").minimal.chain_config, .electra, 0);

    const Mutation = union(enum) {
        none,
        validator_withdrawal_bytes: struct { index: usize, fill: u8 },
        validator_pubkey_and_withdrawal_bytes: struct { index: usize, pub_fill: u8, wd_fill: u8 },
        scores_struct: struct { index: usize, value: u64 },
        append_one_validator_struct: struct { pub_fill: u8 },
        trim_struct: struct { new_len: usize },
    };

    const Case = struct {
        name: []const u8,
        mutation: Mutation,
        expect_modified: []const ValidatorIndex,
        expect_validators_len: usize,
        expect_scores_len: usize,
        expect_score: ?struct { index: usize, value: u64 } = null,
        expect_validator_bytes_match_state_bytes: ?struct { index: usize } = null,
    };

    const expect_none = [_]ValidatorIndex{};
    const expect_one_3 = [_]ValidatorIndex{@intCast(3)};
    const expect_one_5 = [_]ValidatorIndex{@intCast(5)};
    const expect_one_64 = [_]ValidatorIndex{@intCast(64)};

    const cases = [_]Case{
        .{ .name = "no changes", .mutation = .none, .expect_modified = expect_none[0..], .expect_validators_len = 64, .expect_scores_len = 64 },
        .{ .name = "validator withdrawal change (bytes)", .mutation = .{ .validator_withdrawal_bytes = .{ .index = 3, .fill = 0x11 } }, .expect_modified = expect_one_3[0..], .expect_validators_len = 64, .expect_scores_len = 64, .expect_validator_bytes_match_state_bytes = .{ .index = 3 } },
        .{ .name = "validator pubkey+withdrawal change (bytes)", .mutation = .{ .validator_pubkey_and_withdrawal_bytes = .{ .index = 5, .pub_fill = 0x22, .wd_fill = 0x33 } }, .expect_modified = expect_one_5[0..], .expect_validators_len = 64, .expect_scores_len = 64, .expect_validator_bytes_match_state_bytes = .{ .index = 5 } },
        .{ .name = "scores-only change (struct)", .mutation = .{ .scores_struct = .{ .index = 7, .value = 123 } }, .expect_modified = expect_none[0..], .expect_validators_len = 64, .expect_scores_len = 64, .expect_score = .{ .index = 7, .value = 123 } },
        .{ .name = "append one validator (struct)", .mutation = .{ .append_one_validator_struct = .{ .pub_fill = 0x44 } }, .expect_modified = expect_one_64[0..], .expect_validators_len = 65, .expect_scores_len = 65 },
        .{ .name = "trim validators to 63 (struct)", .mutation = .{ .trim_struct = .{ .new_len = 63 } }, .expect_modified = expect_none[0..], .expect_validators_len = 63, .expect_scores_len = 63 },
        .{ .name = "trim validators to 0 (struct)", .mutation = .{ .trim_struct = .{ .new_len = 0 } }, .expect_modified = expect_none[0..], .expect_validators_len = 0, .expect_scores_len = 0 },
    };

    for (cases) |case| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 750_000 });
        defer pool.deinit();

        const state_ptr = try gen.generateElectraState(allocator, &pool, chain_config, 64);
        defer {
            state_ptr.deinit();
            allocator.destroy(state_ptr);
        }

        const genesis_root = (try state_ptr.genesisValidatorsRoot()).*;
        const beacon_config = @import("config").BeaconConfig.init(chain_config, genesis_root);

        const seed_bytes = try state_ptr.serialize(allocator);
        defer allocator.free(seed_bytes);

        var seed_all = try AnyBeaconState.deserialize(allocator, &pool, .electra, seed_bytes);
        defer seed_all.deinit();

        const mutated_bytes = blk: {
            switch (case.mutation) {
                .none => break :blk seed_bytes,
                .validator_withdrawal_bytes => |m| {
                    const validators_field_index = comptime types.electra.BeaconState.getFieldIndex("validators");
                    const ranges = try types.electra.BeaconState.readFieldRanges(seed_bytes);
                    const validators_range = ranges[validators_field_index];
                    const out = try allocator.dupe(u8, seed_bytes);
                    const base = validators_range[0] + m.index * types.phase0.Validator.fixed_size;
                    @memset(out[base + 48 .. base + 80], m.fill);
                    break :blk out;
                },
                .validator_pubkey_and_withdrawal_bytes => |m| {
                    const validators_field_index = comptime types.electra.BeaconState.getFieldIndex("validators");
                    const ranges = try types.electra.BeaconState.readFieldRanges(seed_bytes);
                    const validators_range = ranges[validators_field_index];
                    const out = try allocator.dupe(u8, seed_bytes);
                    const base = validators_range[0] + m.index * types.phase0.Validator.fixed_size;
                    @memset(out[base + 0 .. base + 48], m.pub_fill);
                    @memset(out[base + 48 .. base + 80], m.wd_fill);
                    break :blk out;
                },
                .scores_struct => |m| {
                    var scores = try state_ptr.inactivityScores();
                    try scores.set(m.index, m.value);
                    break :blk try state_ptr.serialize(allocator);
                },
                .append_one_validator_struct => |m| {
                    var validators = try state_ptr.validators();
                    var v: types.phase0.Validator.Type = undefined;
                    try validators.getValue(allocator, 0, &v);
                    v.pubkey = @as(@TypeOf(v.pubkey), [_]u8{m.pub_fill} ** 48);
                    try validators.pushValue(&v);

                    var balances = try state_ptr.balances();
                    try balances.push(try balances.get(0));

                    var scores = try state_ptr.inactivityScores();
                    try scores.push(try scores.get(0));

                    var previous_epoch_participation = try state_ptr.previousEpochParticipation();
                    try previous_epoch_participation.push(try previous_epoch_participation.get(0));

                    var current_epoch_participation = try state_ptr.currentEpochParticipation();
                    try current_epoch_participation.push(try current_epoch_participation.get(0));

                    var eth1_data = try state_ptr.eth1Data();
                    const deposit_count = try eth1_data.get("deposit_count");
                    try eth1_data.set("deposit_count", deposit_count + 1);
                    try state_ptr.setEth1DepositIndex(try state_ptr.eth1DepositIndex() + 1);
                    break :blk try state_ptr.serialize(allocator);
                },
                .trim_struct => |m| {
                    var trimmed = types.electra.BeaconState.default_value;
                    defer types.electra.BeaconState.deinit(allocator, &trimmed);
                    try types.electra.BeaconState.deserializeFromBytes(allocator, seed_bytes, &trimmed);

                    trimmed.validators.shrinkRetainingCapacity(m.new_len);
                    trimmed.balances.shrinkRetainingCapacity(m.new_len);
                    trimmed.inactivity_scores.shrinkRetainingCapacity(m.new_len);
                    trimmed.previous_epoch_participation.shrinkRetainingCapacity(m.new_len);
                    trimmed.current_epoch_participation.shrinkRetainingCapacity(m.new_len);
                    if (m.new_len == 0) {
                        trimmed.eth1_data.deposit_count = 0;
                        trimmed.eth1_deposit_index = 0;
                    }

                    const out_bytes = try allocator.alloc(u8, types.electra.BeaconState.serializedSize(&trimmed));
                    _ = types.electra.BeaconState.serializeIntoBytes(&trimmed, out_bytes);
                    break :blk out_bytes;
                },
            }
        };
        defer if (mutated_bytes.ptr != seed_bytes.ptr) allocator.free(mutated_bytes);

        var out = try loadState(allocator, &beacon_config, &seed_all, mutated_bytes, null);
        defer {
            allocator.free(out.modified_validators);
            var s = out.state;
            s.deinit();
        }

        try std.testing.expectEqual(case.expect_modified.len, out.modified_validators.len);
        for (case.expect_modified, out.modified_validators) |e, got| {
            try std.testing.expectEqual(e, got);
        }

        var migrated_validators = try types.phase0.Validators.TreeView.init(allocator, out.state.nodePool(), try validatorsNodeId(&out.state));
        defer migrated_validators.deinit();

        try std.testing.expectEqual(case.expect_validators_len, try migrated_validators.length());

        var scores = try types.altair.InactivityScores.TreeView.init(allocator, out.state.nodePool(), try inactivityScoresNodeId(&out.state));
        defer scores.deinit();

        try std.testing.expectEqual(case.expect_scores_len, try scores.length());

        if (case.expect_score) |exp| {
            try std.testing.expectEqual(exp.value, try scores.get(exp.index));
        }

        if (case.expect_validator_bytes_match_state_bytes) |exp| {
            const validators_field_index = comptime types.electra.BeaconState.getFieldIndex("validators");
            const ranges = try types.electra.BeaconState.readFieldRanges(mutated_bytes);
            const validators_range = ranges[validators_field_index];
            const base = validators_range[0] + exp.index * types.phase0.Validator.fixed_size;
            var mv = try migrated_validators.get(exp.index);
            // mv is borrowed from migrated_validators; do not deinit.
            var mv_bytes: [types.phase0.Validator.fixed_size]u8 = undefined;
            _ = try mv.serializeIntoBytes(&mv_bytes);
            try std.testing.expectEqualSlices(u8, mutated_bytes[base .. base + types.phase0.Validator.fixed_size], mv_bytes[0..]);
        }

        var fresh_state = try AnyBeaconState.deserialize(allocator, &pool, .electra, mutated_bytes);
        defer fresh_state.deinit();

        try std.testing.expectEqualSlices(u8, try fresh_state.hashTreeRoot(), try out.state.hashTreeRoot());
    }
}

test "diff helpers cases" {
    const allocator = std.testing.allocator;

    const Kind = enum { validators, scores };
    const Case = struct {
        name: []const u8,
        kind: Kind,
        count: usize,
        modified: []const usize = &.{},
        all_modified: bool = false,
    };

    const mod_some_validators = [_]usize{ 0, 1, 63, 64, 127 };
    const mod_some_scores = [_]usize{ 0, 7, 31, 32, 63 };

    const cases = [_]Case{
        .{ .name = "validators: empty", .kind = .validators, .count = 0 },
        .{ .name = "scores: empty", .kind = .scores, .count = 0 },
        .{ .name = "validators: single", .kind = .validators, .count = 1, .modified = &.{0} },
        .{ .name = "scores: single", .kind = .scores, .count = 1, .modified = &.{0} },
        .{ .name = "validators: dense", .kind = .validators, .count = 257, .all_modified = true },
        .{ .name = "scores: dense", .kind = .scores, .count = 257, .all_modified = true },
        .{ .name = "validators: some diff", .kind = .validators, .count = 128, .modified = mod_some_validators[0..] },
        .{ .name = "scores: some diff", .kind = .scores, .count = 64, .modified = mod_some_scores[0..] },
    };

    for (cases) |case| {
        var got: std.ArrayList(ValidatorIndex) = .empty;
        defer got.deinit(allocator);

        if (case.kind == .validators) {
            const total = case.count * types.phase0.Validator.fixed_size;
            const old_bytes = try allocator.alloc(u8, total);
            defer allocator.free(old_bytes);

            const new_bytes = try allocator.alloc(u8, total);
            defer allocator.free(new_bytes);

            for (0..case.count) |i| {
                const start = i * types.phase0.Validator.fixed_size;
                for (0..types.phase0.Validator.fixed_size) |j| {
                    old_bytes[start + j] = @intCast((i + 31 * j) & 0xff);
                }
            }
            @memcpy(new_bytes, old_bytes);

            if (case.all_modified) {
                for (0..case.count) |idx| new_bytes[idx * types.phase0.Validator.fixed_size] ^= 0x5a;
            }
            for (case.modified) |idx| {
                const start = idx * types.phase0.Validator.fixed_size;
                new_bytes[start] ^= 0x5a;
            }

            try findModifiedIndices(
                types.phase0.Validator.fixed_size,
                allocator,
                old_bytes,
                new_bytes,
                &got,
            );
        } else {
            const total = case.count * INACTIVITY_SCORE_SIZE;
            const old_bytes = try allocator.alloc(u8, total);
            defer allocator.free(old_bytes);

            const new_bytes = try allocator.alloc(u8, total);
            defer allocator.free(new_bytes);

            for (0..case.count) |i| {
                const start = i * INACTIVITY_SCORE_SIZE;
                std.mem.writeInt(u64, @ptrCast(old_bytes[start .. start + INACTIVITY_SCORE_SIZE].ptr), @intCast(i * 3), .little);
            }
            @memcpy(new_bytes, old_bytes);

            if (case.all_modified) {
                for (0..case.count) |idx| new_bytes[idx * INACTIVITY_SCORE_SIZE] ^= 0xa5;
            }
            for (case.modified) |idx| {
                const start = idx * INACTIVITY_SCORE_SIZE;
                new_bytes[start] ^= 0xa5;
            }

            try findModifiedIndices(
                INACTIVITY_SCORE_SIZE,
                allocator,
                old_bytes,
                new_bytes,
                &got,
            );
        }

        try std.testing.expectEqual(if (case.all_modified) case.count else case.modified.len, got.items.len);
        for (got.items, 0..) |got_index, i| {
            const expected = if (case.all_modified) i else case.modified[i];
            try std.testing.expectEqual(@as(ValidatorIndex, @intCast(expected)), got_index);
        }
    }
}

test "diff helpers: unchanged inputs do not allocate" {
    const allocator = std.testing.allocator;
    const cases = [_]struct { element_size: usize, count: usize }{
        .{ .element_size = types.phase0.Validator.fixed_size, .count = 128 },
        .{ .element_size = INACTIVITY_SCORE_SIZE, .count = 64 },
    };

    inline for (cases) |case| {
        const total = case.count * case.element_size;
        const old_bytes = try allocator.alloc(u8, total);
        defer allocator.free(old_bytes);
        @memset(old_bytes, 0x5a);

        const new_bytes = try allocator.alloc(u8, total);
        defer allocator.free(new_bytes);
        @memcpy(new_bytes, old_bytes);

        var got: std.ArrayList(ValidatorIndex) = .empty;
        defer got.deinit(allocator);

        try findModifiedIndices(case.element_size, std.testing.failing_allocator, old_bytes, new_bytes, &got);
        try std.testing.expectEqual(@as(usize, 0), got.items.len);
    }
}

test "memory_safety: diff helpers preserve appended indices on allocation failure" {
    inline for (.{ types.phase0.Validator.fixed_size, INACTIVITY_SCORE_SIZE }) |element_size| {
        const old_bytes = [_]u8{0} ** (257 * element_size);
        const new_bytes = [_]u8{1} ** (257 * element_size);

        try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
            fn run(allocator: Allocator, before: []const u8, after: []const u8) !void {
                var got: std.ArrayList(ValidatorIndex) = .empty;
                defer got.deinit(allocator);
                try got.append(allocator, 3);

                findModifiedIndices(element_size, allocator, before, after, &got) catch |err| {
                    try std.testing.expectEqual(error.OutOfMemory, err);
                    try std.testing.expectEqual(@as(ValidatorIndex, 3), got.items[0]);
                    for (got.items[1..], 0..) |index, i| {
                        try std.testing.expectEqual(@as(ValidatorIndex, i), index);
                    }
                    return err;
                };
                try std.testing.expectEqual(@as(usize, 258), got.items.len);
                try std.testing.expectEqual(@as(ValidatorIndex, 3), got.items[0]);
                for (got.items[1..], 0..) |index, i| {
                    try std.testing.expectEqual(@as(ValidatorIndex, i), index);
                }
            }
        }.run, .{ &old_bytes, &new_bytes });
    }
}

test "loadValidators/loadInactivityScores: rejection scenarios" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    const gen = @import("test_utils/generate_state.zig");
    const chain_config = gen.getConfig(@import("config").minimal.chain_config, .electra, 0);
    const state_ptr = try gen.generateElectraState(allocator, &pool, chain_config, 8);
    defer {
        state_ptr.deinit();
        allocator.destroy(state_ptr);
    }

    const StateST = types.electra.BeaconState;
    const migrated_view = state_ptr.castToFork(.electra).inner;

    {
        // new validators bytes length is not a multiple of the validator fixed size
        const seed_validators_node = try validatorsNodeId(state_ptr);
        const bad_bytes = [_]u8{0} ** (types.phase0.Validator.fixed_size + 1);
        try std.testing.expectError(
            error.InvalidSize,
            loadValidators(allocator, StateST, migrated_view, &pool, seed_validators_node, bad_bytes[0..], null),
        );
    }

    {
        // seed_state_validators_bytes length is not a multiple of the validator fixed size
        const seed_validators_node = try validatorsNodeId(state_ptr);
        const good_new_bytes = [_]u8{0} ** (types.phase0.Validator.fixed_size * 2);
        const bad_seed_bytes = [_]u8{0} ** (types.phase0.Validator.fixed_size + 1);
        try std.testing.expectError(
            error.InvalidSize,
            loadValidators(allocator, StateST, migrated_view, &pool, seed_validators_node, good_new_bytes[0..], bad_seed_bytes[0..]),
        );
    }

    {
        // inactivity scores bytes length is not a multiple of INACTIVITY_SCORE_SIZE
        const seed_scores_node = try inactivityScoresNodeId(state_ptr);
        const bad_bytes = [_]u8{0} ** (INACTIVITY_SCORE_SIZE + 1);
        try std.testing.expectError(
            error.InvalidSize,
            loadInactivityScores(allocator, StateST, migrated_view, &pool, seed_scores_node, bad_bytes[0..]),
        );
    }
}

test "memory_safety: loadState releases new inactivity scores on failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 345_000 });
    defer pool.deinit();

    var chain_config = @import("config").minimal.chain_config;
    chain_config.ALTAIR_FORK_EPOCH = 1;
    const beacon_config = BeaconConfig.init(chain_config, .{0} ** 32);

    var seed_value = types.phase0.BeaconState.default_value;
    defer types.phase0.BeaconState.deinit(allocator, &seed_value);
    try seed_value.validators.append(allocator, types.phase0.Validator.default_value);
    try seed_value.balances.append(allocator, 32_000_000_000);
    var seed = try AnyBeaconState.fromValue(allocator, &pool, .phase0, &seed_value);
    defer seed.deinit();
    const seed_root = (try seed.hashTreeRoot()).*;

    var target_value = types.altair.BeaconState.default_value;
    defer types.altair.BeaconState.deinit(allocator, &target_value);
    target_value.slot = @import("preset").preset.SLOTS_PER_EPOCH;
    try target_value.validators.append(allocator, types.phase0.Validator.default_value);
    try target_value.balances.append(allocator, 32_000_000_000);
    try target_value.previous_epoch_participation.append(allocator, 0);
    try target_value.current_epoch_participation.append(allocator, 0);
    try target_value.inactivity_scores.append(allocator, 123);

    const bytes = try allocator.alloc(u8, types.altair.BeaconState.serializedSize(&target_value));
    defer allocator.free(bytes);
    _ = types.altair.BeaconState.serializeIntoBytes(&target_value, bytes);
    const ranges = try types.altair.BeaconState.readFieldRanges(bytes);
    const justification_offset = ranges[comptime types.altair.BeaconState.getFieldIndex("justification_bits")][0];
    const baseline = pool.getNodesInUse();

    bytes[justification_offset] = 0x80;
    try std.testing.expectError(error.trailingData, loadState(allocator, &beacon_config, &seed, bytes, null));
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expectEqualSlices(u8, &seed_root, try seed.hashTreeRoot());
    bytes[justification_offset] = 0;

    // The pool uses its own allocator; the first loadState allocation creates the completed container's view.
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, loadState(failing.allocator(), &beacon_config, &seed, bytes, null));
    try std.testing.expect(failing.has_induced_failure);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expectEqualSlices(u8, &seed_root, try seed.hashTreeRoot());

    {
        var loaded = try loadState(allocator, &beacon_config, &seed, bytes, null);
        defer loaded.state.deinit();
        defer allocator.free(loaded.modified_validators);
        var expected_root: [32]u8 = undefined;
        try types.altair.BeaconState.hashTreeRoot(allocator, &target_value, &expected_root);
        try std.testing.expectEqualSlices(u8, &expected_root, try loaded.state.hashTreeRoot());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expectEqualSlices(u8, &seed_root, try seed.hashTreeRoot());
}
