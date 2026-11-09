//! `fork_choice.Store` for JavaScript.
//!
//! The store owns the block tree and every decision. JavaScript addresses blocks by
//! block index and fork choice nodes by node id, `block index * 3 + payload status`
//! with the spec's status values (`empty = 0`, `full = 1`, `pending = 2`). Both are
//! stable until `prune`, which returns how the block indices moved.
//!
//! Beacon states stay in JavaScript: the two `provider` callbacks answer from them and
//! run synchronously inside whichever call needs them, so they must not throw for a
//! checkpoint or block the store was just told about.

const std = @import("std");
const napi = @import("zapi:zapi").napi;
const js = @import("zapi:zapi").js;
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const constants = @import("constants");
const fork_choice = @import("fork_choice");
const Store = fork_choice.Store;
const ForkChoiceNode = fork_choice.ForkChoiceNode;
const BlockIndex = fork_choice.BlockIndex;
const NO_BLOCK = fork_choice.store.NO_BLOCK;
const Root = fork_choice.store.Root;
const Slot = fork_choice.store.Slot;
const ValidatorIndex = fork_choice.store.ValidatorIndex;
const Checkpoint = fork_choice.Checkpoint;
const AttestationData = fork_choice.store.AttestationData;
const BlockSummary = fork_choice.store.BlockSummary;
const ExecutionStatus = fork_choice.ExecutionStatus;
const BeaconConfig = @import("./BeaconConfig.zig");
const OwnedConfigRc = BeaconConfig.OwnedConfigRc;
const js_types = @import("./js_types.zig");
const sszValueToNapiValue = @import("./to_napi_value.zig").sszValueToNapiValue;

pub const js_meta = js.class(.{ .properties = .{
    .timeMs = js.prop(.{ .get = true, .set = false }),
    .currentSlot = js.prop(.{ .get = true, .set = false }),
    .blockCount = js.prop(.{ .get = true, .set = false }),
    .voteCount = js.prop(.{ .get = true, .set = false }),
    .queuedVoteCount = js.prop(.{ .get = true, .set = false }),
    .equivocatingCount = js.prop(.{ .get = true, .set = false }),
    .proposerBoostRoot = js.prop(.{ .get = true, .set = false }),
    .justifiedTotalBalance = js.prop(.{ .get = true, .set = false }),
} });

const allocator = std.heap.c_allocator;
const NO_INDEX: u32 = std.math.maxInt(u32);
/// An indexed attestation covers at most every committee of one slot.
const max_attesting_indices = preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT;

/// Heap-allocated so the store's provider can point at it for the life of the instance.
const Inner = struct {
    store: Store,
    config_rc: *OwnedConfigRc,
    justified_balances: napi.Ref,
    slot_committee_members: napi.Ref,
    indices: std.ArrayList(ValidatorIndex) = .empty,
    indices_2: std.ArrayList(ValidatorIndex) = .empty,
};

inner: *Inner,
const ForkChoice = @This();

/// `anchor` is a block summary (see `onBlock`) whose `slot` is the anchor state's slot
/// and whose checkpoints are that state's. `provider.justifiedBalances(epoch, root)`
/// returns the effective balance increments of the checkpoint state with inactive and
/// slashed validators zeroed; `provider.slotCommitteeMembers(root, slot)` returns the
/// members of every beacon committee of `slot` in the state of block `root`.
pub fn init(config: *const BeaconConfig, genesis_time: js.Number, anchor: js.Value, provider: js.Value) !ForkChoice {
    const env = js.env();
    const provider_value = provider.toValue();
    const justified_balances = try functionRef(env, provider_value, "justifiedBalances");
    errdefer justified_balances.delete() catch {};
    const slot_committee_members = try functionRef(env, provider_value, "slotCommitteeMembers");
    errdefer slot_committee_members.delete() catch {};

    const config_rc = config.config_rc.ref();
    errdefer config_rc.unref();
    const beacon_config = &config_rc.instance.config;
    const summary = try blockSummary(beacon_config, anchor.toValue());
    const genesis = try genesis_time.toU64Exact();

    const inner = try allocator.create(Inner);
    errdefer allocator.destroy(inner);
    inner.* = .{
        .store = undefined,
        .config_rc = config_rc,
        .justified_balances = justified_balances,
        .slot_committee_members = slot_committee_members,
    };
    inner.store = try Store.initFromSummary(allocator, beacon_config, genesis, summary, .{ .ctx = inner, .vtable = &provider_vtable });
    return .{ .inner = inner };
}

pub fn deinit(self: *ForkChoice) void {
    const inner = self.inner;
    inner.store.deinit();
    inner.indices.deinit(allocator);
    inner.indices_2.deinit(allocator);
    inner.justified_balances.delete() catch {};
    inner.slot_committee_members.delete() catch {};
    inner.config_rc.unref();
    allocator.destroy(inner);
}

fn functionRef(env: napi.Env, object: napi.Value, comptime name: [:0]const u8) !napi.Ref {
    const function = try object.getNamedProperty(name);
    if (try function.typeof() != .function) return error.InvalidProvider;
    return env.createReference(function, 1);
}

const provider_vtable: fork_choice.StateProvider.VTable = .{
    .justifiedBalances = providerJustifiedBalances,
    .slotCommitteeMembers = providerSlotCommitteeMembers,
};

fn providerJustifiedBalances(ctx: *anyopaque, gpa: std.mem.Allocator, checkpoint: Checkpoint) anyerror!fork_choice.JustifiedBalances {
    const inner: *Inner = @ptrCast(@alignCast(ctx));
    const env = js.env();
    const result = try env.callFunction(try inner.justified_balances.getValue(), try env.getUndefined(), .{
        try env.createDouble(@floatFromInt(checkpoint.epoch)),
        js.Uint8Array.from(&checkpoint.root).toValue(),
    });
    try js.Uint16Array.validateArg(result);
    const increments = try js_types.wrap(js.Uint16Array, result).toSlice();
    const owned = try gpa.dupe(u16, increments);
    errdefer gpa.free(owned);
    // The increments arrive with inactive and slashed validators zeroed, so every
    // validator can count as active here.
    var active = try std.DynamicBitSetUnmanaged.initFull(gpa, owned.len);
    errdefer active.deinit(gpa);
    return .{ .effective_balance_increments = owned, .active_unslashed = active };
}

fn providerSlotCommitteeMembers(ctx: *anyopaque, gpa: std.mem.Allocator, root: Root, slot: Slot, out: *std.ArrayList(ValidatorIndex)) anyerror!void {
    const inner: *Inner = @ptrCast(@alignCast(ctx));
    const env = js.env();
    const result = try env.callFunction(try inner.slot_committee_members.getValue(), try env.getUndefined(), .{
        js.Uint8Array.from(&root).toValue(),
        try env.createDouble(@floatFromInt(slot)),
    });
    try js.Uint32Array.validateArg(result);
    const members = try js_types.wrap(js.Uint32Array, result).toSlice();
    if (members.len > max_attesting_indices) return error.TooManyCommitteeMembers;
    try out.ensureUnusedCapacity(gpa, members.len);
    for (members) |member| out.appendAssumeCapacity(member);
}

// --- argument conversion ----------------------------------------------------------

fn toU64(value: napi.Value) !u64 {
    return js_types.wrap(js.Number, value).toU64Exact();
}

fn toRoot(value: napi.Value) !Root {
    const info = try value.getTypedarrayInfo();
    if (info.array_type != .uint8 or info.data.len != 32) return error.InvalidRootLength;
    return info.data[0..32].*;
}

fn rootArg(value: js.Uint8Array) !Root {
    const slice = try value.toSlice();
    if (slice.len != 32) return error.InvalidRootLength;
    return slice[0..32].*;
}

fn isPresent(value: napi.Value) !bool {
    const value_type = try value.typeof();
    return value_type != .undefined and value_type != .null;
}

fn toCheckpoint(value: napi.Value) !Checkpoint {
    return .{
        .epoch = try toU64(try value.getNamedProperty("epoch")),
        .root = try toRoot(try value.getNamedProperty("root")),
    };
}

fn toExecutionStatus(value: u32) !ExecutionStatus {
    return std.enums.fromInt(ExecutionStatus, value) orelse error.InvalidExecutionStatus;
}

/// The facts of spec `on_block` as a JavaScript object. `payloadBlockHash` and
/// `bidParentBlockHash` default to zero, `arrivalMsIntoSlot` to the store's time.
fn blockSummary(config: *const @import("config").BeaconConfig, object: napi.Value) !BlockSummary {
    const slot = try toU64(try object.getNamedProperty("slot"));
    var summary: BlockSummary = .{
        .root = try toRoot(try object.getNamedProperty("root")),
        .parent_root = try toRoot(try object.getNamedProperty("parentRoot")),
        .slot = slot,
        .proposer_index = try toU64(try object.getNamedProperty("proposerIndex")),
        .state_root = try toRoot(try object.getNamedProperty("stateRoot")),
        .fork = config.forkSeq(slot),
        .justified_checkpoint = try toCheckpoint(try object.getNamedProperty("justifiedCheckpoint")),
        .finalized_checkpoint = try toCheckpoint(try object.getNamedProperty("finalizedCheckpoint")),
        .unrealized_justified_checkpoint = try toCheckpoint(try object.getNamedProperty("unrealizedJustifiedCheckpoint")),
        .unrealized_finalized_checkpoint = try toCheckpoint(try object.getNamedProperty("unrealizedFinalizedCheckpoint")),
        .execution_status = try toExecutionStatus(try (try object.getNamedProperty("executionStatus")).getValueUint32()),
    };
    const payload_block_hash = try object.getNamedProperty("payloadBlockHash");
    if (try isPresent(payload_block_hash)) summary.payload_block_hash = try toRoot(payload_block_hash);
    const bid_parent_block_hash = try object.getNamedProperty("bidParentBlockHash");
    if (try isPresent(bid_parent_block_hash)) summary.bid_parent_block_hash = try toRoot(bid_parent_block_hash);
    const arrival = try object.getNamedProperty("arrivalMsIntoSlot");
    if (try isPresent(arrival)) summary.arrival_ms_into_slot = try toU64(arrival);
    return summary;
}

fn toAttestationData(object: napi.Value) !AttestationData {
    return .{
        .slot = try toU64(try object.getNamedProperty("slot")),
        .index = try toU64(try object.getNamedProperty("index")),
        .beacon_block_root = try toRoot(try object.getNamedProperty("beaconBlockRoot")),
        .source = try toCheckpoint(try object.getNamedProperty("source")),
        .target = try toCheckpoint(try object.getNamedProperty("target")),
    };
}

fn widenIndices(list: *std.ArrayList(ValidatorIndex), indices: []const u32) ![]const ValidatorIndex {
    if (indices.len > max_attesting_indices) return error.TooManyAttestingIndices;
    list.clearRetainingCapacity();
    try list.ensureTotalCapacity(allocator, indices.len);
    for (indices) |index| list.appendAssumeCapacity(index);
    return list.items;
}

fn blockArg(self: *const ForkChoice, value: js.Number) !BlockIndex {
    const index = try value.toU32Exact();
    if (index >= self.inner.store.blockCount()) return error.InvalidBlockIndex;
    return index;
}

fn nodeArg(self: *const ForkChoice, value: js.Number) !ForkChoiceNode {
    const id = try value.toU32Exact();
    if (id / 3 >= self.inner.store.blockCount()) return error.InvalidNodeId;
    return .{ .block = id / 3, .payload_status = @enumFromInt(id % 3) };
}

fn nodeNumber(node: ForkChoiceNode) js.Number {
    return js.Number.from(fork_choice.head.nodeId(node));
}

// --- time -------------------------------------------------------------------------

pub fn timeMs(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.time_ms);
}

pub fn currentSlot(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.currentSlot());
}

/// Spec `compute_time_at_slot_ms`.
pub fn timeAtSlotMs(self: *ForkChoice, slot: js.Number) !js.Number {
    return js.Number.from(self.inner.store.timing.timeAtSlotMs(try slot.toU64Exact()));
}

/// Spec `on_tick`. Time does not run backwards: an earlier `time_ms` is ignored.
pub fn onTick(self: *ForkChoice, time_ms: js.Number) !void {
    const time = try time_ms.toU64Exact();
    if (time <= self.inner.store.time_ms) return;
    try self.inner.store.onTick(time);
}

// --- handlers ---------------------------------------------------------------------

/// Spec `on_block` from the block's facts. Returns the block's index.
pub fn onBlock(self: *ForkChoice, block: js.Value) !js.Number {
    const store = &self.inner.store;
    const summary = try blockSummary(store.config, block.toValue());
    try store.onBlockSummary(summary);
    return js.Number.from(store.blockIndex(summary.root).?);
}

/// Spec `on_attestation` for an attestation verified against its target state.
pub fn onAttestation(
    self: *ForkChoice,
    slot: js.Number,
    index: js.Number,
    beacon_block_root: js.Uint8Array,
    target_epoch: js.Number,
    target_root: js.Uint8Array,
    attesting_indices: js.Uint32Array,
    is_from_block: js.Boolean,
) !void {
    const data: AttestationData = .{
        .slot = try slot.toU64Exact(),
        .index = try index.toU64Exact(),
        .beacon_block_root = try rootArg(beacon_block_root),
        .source = .{ .epoch = 0, .root = constants.ZERO_HASH },
        .target = .{ .epoch = try target_epoch.toU64Exact(), .root = try rootArg(target_root) },
    };
    const indices = try widenIndices(&self.inner.indices, try attesting_indices.toSlice());
    try self.inner.store.onAttestationData(&data, indices, try is_from_block.toBool());
}

/// Spec `on_attester_slashing` for two attestations verified against the justified
/// state, each `{slot, index, beaconBlockRoot, source, target}` with its sorted indices.
pub fn onAttesterSlashing(
    self: *ForkChoice,
    data_1: js.Value,
    indices_1: js.Uint32Array,
    data_2: js.Value,
    indices_2: js.Uint32Array,
) !void {
    const attestation_1 = try toAttestationData(data_1.toValue());
    const attestation_2 = try toAttestationData(data_2.toValue());
    const wide_1 = try widenIndices(&self.inner.indices, try indices_1.toSlice());
    const wide_2 = try widenIndices(&self.inner.indices_2, try indices_2.toSlice());
    try self.inner.store.onAttesterSlashingData(&attestation_1, wide_1, &attestation_2, wide_2);
}

/// Spec `notify_ptc_messages` for one indexed payload attestation: `positions` are the
/// PTC positions that voted.
pub fn onPtcVotes(
    self: *ForkChoice,
    beacon_block_root: js.Uint8Array,
    slot: js.Number,
    positions: js.Uint16Array,
    payload_present: js.Boolean,
    blob_data_available: js.Boolean,
) !void {
    try self.inner.store.onPtcVotes(
        try rootArg(beacon_block_root),
        try slot.toU64Exact(),
        try positions.toSlice(),
        try payload_present.toBool(),
        try blob_data_available.toBool(),
    );
}

/// Spec `on_execution_payload_envelope` for a verified envelope. `inclusion_list_satisfied`
/// is the Heze engine verdict, omitted when there is none.
pub fn onExecutionPayload(
    self: *ForkChoice,
    beacon_block_root: js.Uint8Array,
    execution_status: js.Number,
    inclusion_list_satisfied: ?js.Boolean,
) !void {
    const satisfied: ?bool = if (inclusion_list_satisfied) |value| try value.toBool() else null;
    try self.inner.store.onExecutionPayloadEnvelope(
        try rootArg(beacon_block_root),
        try toExecutionStatus(try execution_status.toU32Exact()),
        satisfied,
    );
}

/// Returns whether the verdict changed.
pub fn recordInclusionListSatisfaction(self: *ForkChoice, block: js.Number, satisfied: js.Boolean) !js.Boolean {
    return js.Boolean.from(self.inner.store.recordInclusionListSatisfaction(try self.blockArg(block), try satisfied.toBool()));
}

/// The recorded verdict, `undefined` when the engine reported none.
pub fn inclusionListSatisfaction(self: *ForkChoice, block: js.Number) !?js.Boolean {
    return switch (self.inner.store.blocks.items(.inclusion_list_satisfaction)[try self.blockArg(block)]) {
        .unknown => null,
        .unsatisfied => js.Boolean.from(false),
        .satisfied => js.Boolean.from(true),
    };
}

pub fn isPayloadInclusionListSatisfied(self: *ForkChoice, block: js.Number) !js.Boolean {
    return js.Boolean.from(self.inner.store.isPayloadInclusionListSatisfied(try self.blockArg(block)));
}

/// Optimistic sync: the payload with `block_hash` and those below it are valid.
pub fn onPayloadValid(self: *ForkChoice, block_hash: js.Uint8Array) !void {
    try self.inner.store.onPayloadValid(try rootArg(block_hash));
}

/// Optimistic sync: the engine rejected a block whose parent is `parent_root` and whose
/// payload builds on `parent_block_hash`. See `Store.onPayloadInvalid`.
pub fn onPayloadInvalid(
    self: *ForkChoice,
    parent_root: js.Uint8Array,
    parent_block_hash: js.Uint8Array,
    latest_valid_hash: ?js.Uint8Array,
) !void {
    const lvh: ?Root = if (latest_valid_hash) |hash| try rootArg(hash) else null;
    try self.inner.store.onPayloadInvalid(try rootArg(parent_root), try rootArg(parent_block_hash), lvh);
}

/// Drops every block that does not descend from the finalized block. Returns the new
/// index of each old block index, `0xffffffff` for a dropped block, or `undefined` when
/// nothing was dropped.
pub fn prune(self: *ForkChoice) !?js.Uint32Array {
    const store = &self.inner.store;
    const old_count = store.blockCount();
    const old_roots = try allocator.dupe(Root, store.blocks.items(.root));
    defer allocator.free(old_roots);
    if (try store.prune() == 0) return null;
    const remap = try js.Uint32Array.alloc(old_count);
    for (old_roots, try remap.toSlice()) |root, *target| target.* = store.blockIndex(root) orelse NO_INDEX;
    return remap;
}

// --- head -------------------------------------------------------------------------

/// Spec `get_head` as a node id.
pub fn getHead(self: *ForkChoice) !js.Number {
    return nodeNumber(try self.inner.store.getHead());
}

/// Spec `get_proposer_head` for the head node `head` and proposal `slot`: the node id to
/// build on when the head is reorged out, otherwise the reason it is kept.
pub fn getProposerHead(self: *ForkChoice, head: js.Number, slot: js.Number) !js.Value {
    const env = js.env();
    const decision = try fork_choice.proposer_head.decide(&self.inner.store, try self.nodeArg(head), try slot.toU64Exact());
    return switch (decision) {
        .reorg => |node| js_types.wrap(js.Value, nodeNumber(node).toValue()),
        .keep => |reason| js_types.wrap(js.Value, try env.createStringUtf8(@tagName(reason))),
    };
}

/// Spec `is_head_weak`.
pub fn isHeadWeak(self: *ForkChoice, block: js.Number) !js.Boolean {
    const store = &self.inner.store;
    const index = try self.blockArg(block);
    try fork_choice.head.ensureComputed(store);
    return js.Boolean.from(try fork_choice.head.isHeadWeak(store, index));
}

/// Spec `is_parent_strong` for the parent of `block`.
pub fn isParentStrong(self: *ForkChoice, block: js.Number) !js.Boolean {
    const store = &self.inner.store;
    const index = try self.blockArg(block);
    if (store.blocks.items(.parent)[index] == NO_BLOCK) return error.UnknownParent;
    try fork_choice.head.ensureComputed(store);
    return js.Boolean.from(fork_choice.head.isParentStrong(store, index));
}

/// Spec `is_proposer_equivocation`.
pub fn isProposerEquivocation(self: *ForkChoice, block: js.Number) !js.Boolean {
    return js.Boolean.from(fork_choice.proposer_head.isProposerEquivocation(&self.inner.store, try self.blockArg(block)));
}

/// Spec `get_weight` per node id, in Gwei.
pub fn weights(self: *ForkChoice) !js.BigUint64Array {
    const store = &self.inner.store;
    try fork_choice.head.ensureComputed(store);
    const out = try js.BigUint64Array.alloc(store.blockCount() * 3);
    for (try out.toSlice(), 0..) |*weight, id| {
        weight.* = fork_choice.head.weight(store, .{ .block = @intCast(id / 3), .payload_status = @enumFromInt(id % 3) });
    }
    return out;
}

/// Spec `get_attestation_score` per node id, in Gwei.
pub fn attestationScores(self: *ForkChoice) !js.BigUint64Array {
    const store = &self.inner.store;
    try fork_choice.head.ensureComputed(store);
    return js.BigUint64Array.from(store.head_cache.weight.items);
}

/// The best child of each node id, `0xffffffff` for a node without a viable child.
pub fn bestChildren(self: *ForkChoice) !js.Uint32Array {
    const store = &self.inner.store;
    try fork_choice.head.ensureComputed(store);
    return js.Uint32Array.from(store.head_cache.best_child.items);
}

/// The worst engine verdict on the payloads each node id stands on.
pub fn executionStatuses(self: *ForkChoice) !js.Uint8Array {
    const store = &self.inner.store;
    try fork_choice.head.ensureComputed(store);
    return js.Uint8Array.from(@ptrCast(store.head_cache.execution.items));
}

/// Leaves of the filtered block tree as `{root, payloadStatus, weight}`.
pub fn viableHeads(self: *ForkChoice) !js.Array {
    const env = js.env();
    const heads = try self.inner.store.viableHeads(allocator);
    defer allocator.free(heads);
    const out = try env.createArrayWithLength(heads.len);
    for (heads, 0..) |head, i| {
        const object = try env.createObject();
        try object.setNamedProperty("root", js.Uint8Array.from(&head.root).toValue());
        try object.setNamedProperty("payloadStatus", try env.createUint32(@intFromEnum(head.payload_status)));
        try object.setNamedProperty("weight", try env.createBigintUint64(head.weight));
        try out.setElement(@intCast(i), object);
    }
    return js_types.wrap(js.Array, out);
}

// --- store state ------------------------------------------------------------------

pub fn blockCount(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.blockCount());
}

/// Validators the store has a latest message slot for.
pub fn voteCount(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.latest_votes.items.len);
}

pub fn queuedVoteCount(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.queuedVoteCount());
}

pub fn equivocatingCount(self: *ForkChoice) js.Number {
    return js.Number.from(self.inner.store.equivocating_indices.count());
}

pub fn proposerBoostRoot(self: *ForkChoice) js.Uint8Array {
    return js.Uint8Array.from(&self.inner.store.proposer_boost_root);
}

/// Total active unslashed balance of the justified state in Gwei.
pub fn justifiedTotalBalance(self: *ForkChoice) js.BigInt {
    return js.BigInt.from(self.inner.store.justified_total_balance);
}

/// The store's four checkpoints as `{epoch, root}`.
pub fn checkpoints(self: *ForkChoice) !js.Value {
    const env = js.env();
    const store = &self.inner.store;
    const object = try env.createObject();
    try object.setNamedProperty("justified", try sszValueToNapiValue(env, ct.phase0.Checkpoint, &store.justified_checkpoint));
    try object.setNamedProperty("finalized", try sszValueToNapiValue(env, ct.phase0.Checkpoint, &store.finalized_checkpoint));
    try object.setNamedProperty("unrealizedJustified", try sszValueToNapiValue(env, ct.phase0.Checkpoint, &store.unrealized_justified_checkpoint));
    try object.setNamedProperty("unrealizedFinalized", try sszValueToNapiValue(env, ct.phase0.Checkpoint, &store.unrealized_finalized_checkpoint));
    return js_types.wrap(js.Value, object);
}

/// The index of the block with `root`, `undefined` when the store does not have it.
pub fn blockIndex(self: *ForkChoice, root: js.Uint8Array) !?js.Number {
    const index = self.inner.store.blockIndex(try rootArg(root)) orelse return null;
    return js.Number.from(index);
}

/// The node id the block's `pending` node hangs from, `undefined` for the root block.
pub fn parentNode(self: *ForkChoice, block: js.Number) !?js.Number {
    const store = &self.inner.store;
    const index = try self.blockArg(block);
    const parent = store.blocks.items(.parent)[index];
    if (parent == NO_BLOCK) return null;
    return nodeNumber(.{ .block = parent, .payload_status = store.blocks.items(.parent_payload_status)[index] });
}

/// Spec `get_ancestor` on node ids.
pub fn getAncestor(self: *ForkChoice, node: js.Number, slot: js.Number) !js.Number {
    return nodeNumber(self.inner.store.getAncestor(try self.nodeArg(node), try slot.toU64Exact()));
}

/// Whether the block descends from, or is, the store's finalized block.
pub fn isFinalizedDescendant(self: *ForkChoice, block: js.Number) !js.Boolean {
    const store = &self.inner.store;
    const ancestor = store.getCheckpointBlock(try self.blockArg(block), store.finalized_checkpoint.epoch);
    return js.Boolean.from(std.mem.eql(u8, &store.blockRoot(ancestor), &store.finalized_checkpoint.root));
}

/// Spec `[proposer-timely, PTC-timely]` of `store.block_timeliness[root]`.
pub fn blockTimeliness(self: *ForkChoice, block: js.Number) !js.Array {
    const env = js.env();
    const timely = self.inner.store.blocks.items(.timely)[try self.blockArg(block)];
    const out = try env.createArrayWithLength(timely.len);
    for (timely, 0..) |value, i| try out.setElement(@intCast(i), try env.getBoolean(value));
    return js_types.wrap(js.Array, out);
}

/// One byte per PTC position: bit 0 voted, bit 1 payload present, bit 2 blob data available.
pub fn ptcVotes(self: *ForkChoice, block: js.Number) !js.Uint8Array {
    const votes = &self.inner.store.ptc_votes.items[try self.blockArg(block)];
    return js.Uint8Array.from(@ptrCast(votes));
}

/// Spec `should_extend_payload`. The block must be from the slot before the store's.
pub fn shouldExtendPayload(self: *ForkChoice, block: js.Number) !js.Boolean {
    return js.Boolean.from(try self.inner.store.shouldExtendPayload(try self.blockArg(block)));
}

/// Spec `should_build_on_full` for an `empty` or `full` head node.
pub fn shouldBuildOnFull(self: *ForkChoice, head: js.Number, slot: js.Number) !js.Boolean {
    const node = try self.nodeArg(head);
    if (node.payload_status == .pending) return error.PendingHeadNode;
    return js.Boolean.from(self.inner.store.shouldBuildOnFull(node, try slot.toU64Exact()));
}

/// Every validator's latest message: its slot (`NaN` for none) and the node id it
/// counts on (`0xffffffff` for none or a pruned block).
pub fn latestMessages(self: *ForkChoice) !js.Value {
    const env = js.env();
    const store = &self.inner.store;
    const votes = store.latest_votes.items;
    const slots = try js.Float64Array.alloc(votes.len);
    const nodes = try js.Uint32Array.alloc(votes.len);
    const messages = store.vote_targets.messages.items;
    const target_nodes = store.vote_targets.nodes.items;
    for (votes, try slots.toSlice(), try nodes.toSlice()) |id, *slot, *node| {
        const voted = id != fork_choice.vote_targets.NO_TARGET;
        slot.* = if (voted) @floatFromInt(messages[id].slot) else std.math.nan(f64);
        node.* = target_nodes[id];
    }
    const object = try env.createObject();
    try object.setNamedProperty("slots", slots.toValue());
    try object.setNamedProperty("nodes", nodes.toValue());
    return js_types.wrap(js.Value, object);
}
