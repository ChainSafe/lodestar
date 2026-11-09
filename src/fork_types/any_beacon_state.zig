const std = @import("std");
const AnyStateList = @import("any_state_list.zig").AnyStateList;
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const ForkSeq = @import("config").ForkSeq;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const createSingleProof = @import("persistent_merkle_tree").proof.createSingleProof;
const SingleProof = @import("persistent_merkle_tree").proof.SingleProof;
const isBasicType = @import("ssz").isBasicType;
const CloneOpts = @import("ssz").CloneOpts;
const ct = @import("consensus_types");
const constants = @import("constants");
const BeaconState = @import("./beacon_state.zig").BeaconState;
const AnyExecutionPayloadHeader = @import("./any_execution_payload.zig").AnyExecutionPayloadHeader;

pub fn readSlotFromAnyBeaconStateBytes(bytes: []const u8) u64 {
    // slot is at offset 40: 8 (genesisTime) + 32 (genesisValidatorsRoot)
    std.debug.assert(bytes.len >= 48);
    return std.mem.readInt(u64, bytes[40..][0..8], .little);
}

/// wrapper for all AnyBeaconState types across forks so that we don't have to do switch/case for all methods
pub const AnyBeaconState = union(ForkSeq) {
    phase0: *ct.phase0.BeaconState.TreeView,
    altair: *ct.altair.BeaconState.TreeView,
    bellatrix: *ct.bellatrix.BeaconState.TreeView,
    capella: *ct.capella.BeaconState.TreeView,
    deneb: *ct.deneb.BeaconState.TreeView,
    electra: *ct.electra.BeaconState.TreeView,
    fulu: *ct.fulu.BeaconState.TreeView,
    gloas: *ct.gloas.BeaconState.TreeView,
    heze: *ct.heze.BeaconState.TreeView,

    pub fn fromValue(allocator: Allocator, pool: *Node.Pool, comptime fork_seq: ForkSeq, value: anytype) !AnyBeaconState {
        return switch (fork_seq) {
            .phase0 => .{
                .phase0 = try ct.phase0.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .altair => .{
                .altair = try ct.altair.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .bellatrix => .{
                .bellatrix = try ct.bellatrix.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .capella => .{
                .capella = try ct.capella.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .deneb => .{
                .deneb = try ct.deneb.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .electra => .{
                .electra = try ct.electra.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .fulu => .{
                .fulu = try ct.fulu.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .gloas => .{
                .gloas = try ct.gloas.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
            .heze => .{
                .heze = try ct.heze.BeaconState.TreeView.fromValue(allocator, pool, value),
            },
        };
    }

    pub fn deserialize(allocator: Allocator, pool: *Node.Pool, fork_seq: ForkSeq, bytes: []const u8) !AnyBeaconState {
        return switch (fork_seq) {
            .phase0 => .{
                .phase0 = try ct.phase0.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .altair => .{
                .altair = try ct.altair.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .bellatrix => .{
                .bellatrix = try ct.bellatrix.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .capella => .{
                .capella = try ct.capella.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .deneb => .{
                .deneb = try ct.deneb.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .electra => .{
                .electra = try ct.electra.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .fulu => .{
                .fulu = try ct.fulu.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .gloas => .{
                .gloas = try ct.gloas.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
            .heze => .{
                .heze = try ct.heze.BeaconState.TreeView.deserialize(allocator, pool, bytes),
            },
        };
    }

    pub fn serialize(self: AnyBeaconState, allocator: Allocator) ![]u8 {
        const s = self;
        switch (s) {
            .phase0 => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .altair => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .bellatrix => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .capella => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .deneb => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .electra => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .fulu => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .gloas => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
            .heze => |state| {
                const out = try allocator.alloc(u8, try state.serializedSize());
                errdefer allocator.free(out);
                _ = try state.serializeIntoBytes(out);
                return out;
            },
        }
    }

    pub fn format(
        self: AnyBeaconState,
        comptime fmt: []const u8,
        options: std.fmt.Options,
        writer: anytype,
    ) !void {
        _ = fmt;
        _ = options;
        return switch (self) {
            inline else => {
                try writer.print("{s} (at slot {})", .{ @tagName(self), self.slot() });
            },
        };
    }

    pub fn clone(self: *AnyBeaconState, opts: CloneOpts) !AnyBeaconState {
        return switch (self.*) {
            .phase0 => |state| .{ .phase0 = try state.clone(opts) },
            .altair => |state| .{ .altair = try state.clone(opts) },
            .bellatrix => |state| .{ .bellatrix = try state.clone(opts) },
            .capella => |state| .{ .capella = try state.clone(opts) },
            .deneb => |state| .{ .deneb = try state.clone(opts) },
            .electra => |state| .{ .electra = try state.clone(opts) },
            .fulu => |state| .{ .fulu = try state.clone(opts) },
            .gloas => |state| .{ .gloas = try state.clone(opts) },
            .heze => |state| .{ .heze = try state.clone(opts) },
        };
    }

    pub fn commit(self: *AnyBeaconState) !void {
        switch (self.*) {
            inline else => |state| try state.commit(),
        }
    }

    /// Get a Merkle proof for a node at the given generalized index.
    pub fn getSingleProof(self: *AnyBeaconState, allocator: Allocator, gindex_value: u64) !SingleProof {
        try self.commit();
        const gindex: Gindex = @enumFromInt(gindex_value);
        return switch (self.*) {
            inline else => |state| try createSingleProof(
                allocator,
                state.pool,
                state.root,
                gindex,
            ),
        };
    }

    /// Get a Merkle proof for the finalized root in the beacon state.
    pub fn getFinalizedRootProof(self: *AnyBeaconState, allocator: Allocator) !SingleProof {
        const gindex_value: u64 = switch (self.*) {
            .electra, .fulu => constants.FINALIZED_ROOT_GINDEX_ELECTRA,
            .gloas, .heze => constants.FINALIZED_ROOT_GINDEX_GLOAS,
            else => constants.FINALIZED_ROOT_GINDEX,
        };
        return self.getSingleProof(allocator, gindex_value);
    }

    pub fn hashTreeRoot(self: *AnyBeaconState) !*const [32]u8 {
        return switch (self.*) {
            inline else => |state| try state.hashTreeRoot(),
        };
    }

    pub fn deinit(self: *AnyBeaconState) void {
        switch (self.*) {
            inline else => |state| state.deinit(),
        }
    }

    pub fn forkSeq(self: *AnyBeaconState) ForkSeq {
        return std.meta.activeTag(self.*);
    }

    /// Underlying persistent merkle tree pool, regardless of fork variant.
    pub fn nodePool(self: *AnyBeaconState) *Node.Pool {
        return switch (self.*) {
            inline else => |state| state.pool,
        };
    }

    /// Root node of the underlying tree view, regardless of fork variant.
    pub fn root(self: *AnyBeaconState) Node.Id {
        return switch (self.*) {
            inline else => |state| state.root,
        };
    }

    // pub fn castFromFork(comptime f: ForkSeq, )

    pub fn castToFork(self: *AnyBeaconState, comptime f: ForkSeq) *BeaconState(f) {
        return @ptrCast(&@field(self, @tagName(f)));
    }

    pub fn tryCastToFork(self: *AnyBeaconState, comptime f: ForkSeq) !*BeaconState(f) {
        if (self.forkSeq() != f) {
            return error.InvalidForkCast;
        }
        return self.castToFork(f);
    }

    pub fn genesisTime(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            inline else => |state| try state.get("genesis_time"),
        };
    }

    pub fn genesisValidatorsRoot(self: *AnyBeaconState) !*const [32]u8 {
        return switch (self.*) {
            inline else => |state| try state.getFieldRoot("genesis_validators_root"),
        };
    }

    pub fn slot(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            inline else => |state| try state.get("slot"),
        };
    }

    pub fn setSlot(self: *AnyBeaconState, s: u64) !void {
        switch (self.*) {
            inline else => |state| try state.set("slot", s),
        }
    }

    pub fn fork(self: *AnyBeaconState) !*ct.phase0.Fork.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("fork"),
        };
    }

    pub fn forkCurrentVersion(self: *AnyBeaconState) ![4]u8 {
        var f = switch (self.*) {
            inline else => |state| try state.getReadonly("fork"),
        };
        const current_version_root = try f.getFieldRoot("current_version");
        var version: [4]u8 = undefined;
        @memcpy(&version, current_version_root[0..4]);
        return version;
    }

    pub fn setFork(self: *AnyBeaconState, f: *const ct.phase0.Fork.Type) !void {
        switch (self.*) {
            inline else => |state| try state.setValue("fork", f),
        }
    }

    pub fn latestBlockHeader(self: *AnyBeaconState) !*ct.phase0.BeaconBlockHeader.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("latest_block_header"),
        };
    }

    pub fn setLatestBlockHeader(self: *AnyBeaconState, header: *const ct.phase0.BeaconBlockHeader.Type) !void {
        switch (self.*) {
            inline else => |state| try state.setValue("latest_block_header", header),
        }
    }

    pub fn blockRoots(self: *AnyBeaconState) !*ct.phase0.HistoricalBlockRoots.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("block_roots"),
        };
    }

    pub fn blockRootsRoot(self: *AnyBeaconState) !*const [32]u8 {
        return switch (self.*) {
            inline else => |state| try state.getFieldRoot("block_roots"),
        };
    }

    pub fn stateRoots(self: *AnyBeaconState) !*ct.phase0.HistoricalStateRoots.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("state_roots"),
        };
    }

    pub fn stateRootsRoot(self: *AnyBeaconState) !*const [32]u8 {
        return switch (self.*) {
            inline else => |state| try state.getFieldRoot("state_roots"),
        };
    }

    pub fn historicalRoots(self: *AnyBeaconState) !*ct.phase0.HistoricalRoots.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("historical_roots"),
        };
    }

    pub fn eth1Data(self: *AnyBeaconState) !*ct.phase0.Eth1Data.TreeView {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.get("eth1_data"),
        };
    }

    pub fn setEth1Data(self: *AnyBeaconState, eth1_data: *const ct.phase0.Eth1Data.Type) !void {
        switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.setValue("eth1_data", eth1_data),
        }
    }

    pub fn eth1DataVotes(self: *AnyBeaconState) !*ct.phase0.Eth1DataVotes.TreeView {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.get("eth1_data_votes"),
        };
    }

    pub fn setEth1DataVotes(self: *AnyBeaconState, eth1_data_votes: *ct.phase0.Eth1DataVotes.TreeView) !void {
        switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.set("eth1_data_votes", eth1_data_votes),
        }
    }

    pub fn appendEth1DataVote(self: *AnyBeaconState, eth1_data: *const ct.phase0.Eth1Data.Type) !void {
        var votes = try self.eth1DataVotes();
        try votes.pushValue(eth1_data);
    }

    pub fn resetEth1DataVotes(self: *AnyBeaconState) !void {
        switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.setValue("eth1_data_votes", &ct.phase0.Eth1DataVotes.default_value),
        }
    }

    pub fn eth1DepositIndex(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.get("eth1_deposit_index"),
        };
    }

    pub fn setEth1DepositIndex(self: *AnyBeaconState, index: u64) !void {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            inline else => |state| try state.set("eth1_deposit_index", index),
        };
    }

    pub fn incrementEth1DepositIndex(self: *AnyBeaconState) !void {
        try self.setEth1DepositIndex(try self.eth1DepositIndex() + 1);
    }

    pub fn buildersLength(self: *AnyBeaconState) !usize {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb, .electra, .fulu => error.InvalidAtFork,
            inline else => |state| {
                var builders_view = try state.getReadonly("builders");
                return builders_view.length();
            },
        };
    }

    fn getListField(self: *AnyBeaconState, comptime field: []const u8) !AnyStateList(field) {
        return switch (self.*) {
            inline else => |state, fork_seq| {
                const State = @TypeOf(state.*).SszType;
                if (comptime @hasField(State.Type, field)) {
                    return AnyStateList(field).fromView(fork_seq, try state.get(field));
                }
                return error.InvalidAtFork;
            },
        };
    }

    fn setListField(self: *AnyBeaconState, comptime field: []const u8, value: AnyStateList(field)) !void {
        return switch (self.*) {
            inline else => |state| {
                const State = @TypeOf(state.*).SszType;
                if (comptime @hasField(State.Type, field)) {
                    const view = value.unwrap(State.getFieldType(field)) catch return error.InvalidAtFork;
                    return state.set(field, view);
                }
                return error.InvalidAtFork;
            },
        };
    }

    pub fn validators(self: *AnyBeaconState) !AnyStateList("validators") {
        return self.getListField("validators");
    }

    pub fn validatorsCount(self: *AnyBeaconState) !usize {
        return switch (self.*) {
            inline else => |state| {
                var validators_view = try state.getReadonly("validators");
                return validators_view.length();
            },
        };
    }

    /// Returns a read-only slice of validators.
    /// This is read-only in the sense that modifications will not be reflected back to the state.
    /// Caller owns the returned slice and must free it with the same allocator.
    pub fn validatorsSlice(self: *AnyBeaconState, allocator: Allocator) ![]ct.phase0.Validator.Type {
        return switch (self.*) {
            inline else => |state| {
                var validators_view = try state.getReadonly("validators");
                try validators_view.commit();
                return validators_view.getAllReadonlyValues(allocator);
            },
        };
    }

    /// Pointer-slice version of `validatorsSlice` that hands out
    /// `*const Validator.Type` into the pool's container_struct payloads —
    /// no clone. Pointers are valid only while the validators list is not
    /// mutated; copy out values that must survive a `tree.set`.
    pub fn validatorsPtrSlice(self: *AnyBeaconState, allocator: Allocator) ![]*const ct.phase0.Validator.Type {
        return switch (self.*) {
            inline else => |state| {
                var validators_view = try state.getReadonly("validators");
                try validators_view.commit();
                const len = try validators_view.length();
                const out = try allocator.alloc(*const ct.phase0.Validator.Type, len);
                errdefer allocator.free(out);
                var it = validators_view.iteratorReadonly(0);
                for (0..len) |i| {
                    out[i] = try it.nextValuePtr();
                }
                return out;
            },
        };
    }

    pub fn balances(self: *AnyBeaconState) !AnyStateList("balances") {
        return self.getListField("balances");
    }

    /// Returns a read-only slice of balances.
    /// This is read-only in the sense that modifications will not be reflected back to the state.
    /// Caller owns the returned slice and must free it with the same allocator.
    pub fn balancesSlice(self: *AnyBeaconState, allocator: Allocator) ![]u64 {
        return switch (self.*) {
            inline else => |state| {
                var balances_view = try state.get("balances");
                try balances_view.commit();
                return balances_view.getAll(allocator);
            },
        };
    }

    pub fn setBalances(self: *AnyBeaconState, b: *const ct.phase0.Balances.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.setValue("balances", b),
        };
    }

    pub fn randaoMixes(self: *AnyBeaconState) !*ct.phase0.RandaoMixes.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("randao_mixes"),
        };
    }

    pub fn setRandaoMix(self: *AnyBeaconState, epoch: u64, randao_mix: *const ct.primitive.Bytes32.Type) !void {
        var mixes = try self.randaoMixes();
        try mixes.setValue(epoch % preset.EPOCHS_PER_HISTORICAL_VECTOR, randao_mix);
    }

    pub fn slashings(self: *AnyBeaconState) !*ct.phase0.Slashings.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("slashings"),
        };
    }

    pub fn previousEpochPendingAttestations(self: *AnyBeaconState) !*ct.phase0.EpochAttestations.TreeView {
        return switch (self.*) {
            .phase0 => |state| try state.get("previous_epoch_attestations"),
            else => error.InvalidAtFork,
        };
    }

    pub fn currentEpochPendingAttestations(self: *AnyBeaconState) !*ct.phase0.EpochAttestations.TreeView {
        return switch (self.*) {
            .phase0 => |state| try state.get("current_epoch_attestations"),
            else => error.InvalidAtFork,
        };
    }

    pub fn rotateEpochPendingAttestations(self: *AnyBeaconState) !void {
        return switch (self.*) {
            .phase0 => |state| {
                const current_root = try state.getRootNode("current_epoch_attestations");
                try state.setRootNode("previous_epoch_attestations", current_root);
                try state.setValue("current_epoch_attestations", &ct.phase0.EpochAttestations.default_value);
            },
            else => error.InvalidAtFork,
        };
    }

    pub fn previousEpochParticipation(self: *AnyBeaconState) !AnyStateList("previous_epoch_participation") {
        return self.getListField("previous_epoch_participation");
    }

    pub fn setPreviousEpochParticipation(self: *AnyBeaconState, participations: *const ct.altair.EpochParticipation.Type) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.setValue("previous_epoch_participation", participations),
        };
    }

    pub fn currentEpochParticipation(self: *AnyBeaconState) !AnyStateList("current_epoch_participation") {
        return self.getListField("current_epoch_participation");
    }

    pub fn setCurrentEpochParticipation(self: *AnyBeaconState, participations: *const ct.altair.EpochParticipation.Type) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.setValue("current_epoch_participation", participations),
        };
    }

    pub fn rotateEpochParticipation(self: *AnyBeaconState) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| {
                var current_epoch_participation = try state.get("current_epoch_participation");
                try current_epoch_participation.commit();
                const length = try current_epoch_participation.length();
                try state.set(
                    "previous_epoch_participation",
                    // cannot set without cloning because the original is owned by the tree
                    // we need to clone it to create an owned tree
                    try current_epoch_participation.clone(.{ .transfer_cache = true }),
                );

                // Reset current_epoch_participation by rebuilding a zeroed SSZ List of the same length.
                const Participation = @TypeOf(current_epoch_participation.*).SszType;
                const new_current_root = try Participation.tree.zeros(
                    state.pool,
                    length,
                );
                errdefer state.pool.unref(new_current_root);
                try state.setRootNode("current_epoch_participation", new_current_root);
            },
        };
    }

    pub fn justificationBits(self: *AnyBeaconState) !*ct.phase0.JustificationBits.TreeView {
        return switch (self.*) {
            inline else => |state| try state.get("justification_bits"),
        };
    }

    pub fn setJustificationBits(self: *AnyBeaconState, bits: *const ct.phase0.JustificationBits.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.setValue("justification_bits", bits),
        };
    }

    pub fn previousJustifiedCheckpoint(self: *AnyBeaconState, out: *ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.getValue(undefined, "previous_justified_checkpoint", out),
        };
    }

    pub fn setPreviousJustifiedCheckpoint(self: *AnyBeaconState, checkpoint: *const ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.setValue("previous_justified_checkpoint", checkpoint),
        };
    }

    pub fn currentJustifiedCheckpoint(self: *AnyBeaconState, out: *ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.getValue(undefined, "current_justified_checkpoint", out),
        };
    }

    pub fn setCurrentJustifiedCheckpoint(self: *AnyBeaconState, checkpoint: *const ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.setValue("current_justified_checkpoint", checkpoint),
        };
    }

    pub fn finalizedCheckpoint(self: *AnyBeaconState, out: *ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.getValue(undefined, "finalized_checkpoint", out),
        };
    }

    pub fn setFinalizedCheckpoint(self: *AnyBeaconState, checkpoint: *const ct.phase0.Checkpoint.Type) !void {
        return switch (self.*) {
            inline else => |state| try state.setValue("finalized_checkpoint", checkpoint),
        };
    }

    pub fn finalizedEpoch(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            inline else => |state| {
                var checkpoint_view = try state.getReadonly("finalized_checkpoint");
                return try checkpoint_view.get("epoch");
            },
        };
    }

    pub fn inactivityScores(self: *AnyBeaconState) !AnyStateList("inactivity_scores") {
        return self.getListField("inactivity_scores");
    }

    pub fn currentSyncCommittee(self: *AnyBeaconState) !*ct.altair.SyncCommittee.TreeView {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.get("current_sync_committee"),
        };
    }

    pub fn setCurrentSyncCommittee(self: *AnyBeaconState, sync_committee: *const ct.altair.SyncCommittee.Type) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.setValue("current_sync_committee", sync_committee),
        };
    }

    pub fn nextSyncCommittee(self: *AnyBeaconState) !*ct.altair.SyncCommittee.TreeView {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.get("next_sync_committee"),
        };
    }

    pub fn setNextSyncCommittee(self: *AnyBeaconState, sync_committee: *const ct.altair.SyncCommittee.Type) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| try state.setValue("next_sync_committee", sync_committee),
        };
    }

    pub fn rotateSyncCommittees(self: *AnyBeaconState, next_sync_committee: *const ct.altair.SyncCommittee.Type) !void {
        return switch (self.*) {
            .phase0 => error.InvalidAtFork,
            inline else => |state| {
                const next_sync_committee_root = try state.getRootNode("next_sync_committee");
                try state.setRootNode("current_sync_committee", next_sync_committee_root);
                try state.setValue("next_sync_committee", next_sync_committee);
            },
        };
    }

    pub fn latestExecutionPayloadHeader(self: *AnyBeaconState, allocator: Allocator, out: *AnyExecutionPayloadHeader) !void {
        return switch (self.*) {
            .phase0, .altair, .gloas, .heze => error.InvalidAtFork,
            .bellatrix => |state| {
                out.* = .{ .bellatrix = ct.bellatrix.ExecutionPayloadHeader.default_value };
                try state.getValue(allocator, "latest_execution_payload_header", &out.bellatrix);
            },
            .capella => |state| {
                out.* = .{ .capella = ct.capella.ExecutionPayloadHeader.default_value };
                try state.getValue(allocator, "latest_execution_payload_header", &out.capella);
            },
            .deneb => |state| {
                out.* = .{ .deneb = ct.deneb.ExecutionPayloadHeader.default_value };
                try state.getValue(allocator, "latest_execution_payload_header", &out.deneb);
            },
            .electra => |state| {
                out.* = .{ .deneb = ct.deneb.ExecutionPayloadHeader.default_value };
                try state.getValue(allocator, "latest_execution_payload_header", &out.deneb);
            },
            .fulu => |state| {
                out.* = .{ .deneb = ct.deneb.ExecutionPayloadHeader.default_value };
                try state.getValue(allocator, "latest_execution_payload_header", &out.deneb);
            },
        };
    }

    pub fn latestExecutionPayloadHeaderBlockHash(self: *AnyBeaconState) !*const [32]u8 {
        return switch (self.*) {
            .phase0, .altair, .gloas, .heze => error.InvalidAtFork,
            inline else => |state| {
                var header = try state.get("latest_execution_payload_header");
                return try header.getFieldRoot("block_hash");
            },
        };
    }

    pub fn executionPayloadAvailability(self: *AnyBeaconState, index: usize) !bool {
        return switch (self.*) {
            inline .gloas, .heze => |state| {
                var bv = try state.get("execution_payload_availability");
                return try bv.get(index);
            },
            inline else => error.InvalidAtFork,
        };
    }

    pub fn setLatestExecutionPayloadHeader(self: *AnyBeaconState, header: *const AnyExecutionPayloadHeader) !void {
        switch (self.*) {
            .bellatrix => |state| try state.setValue("latest_execution_payload_header", &header.bellatrix),
            .capella => |state| try state.setValue("latest_execution_payload_header", &header.capella),
            .deneb => |state| try state.setValue("latest_execution_payload_header", &header.deneb),
            .electra => |state| try state.setValue("latest_execution_payload_header", &header.deneb),
            .fulu => |state| try state.setValue("latest_execution_payload_header", &header.deneb),
            .phase0, .altair, .gloas, .heze => return error.InvalidAtFork,
        }
    }

    pub fn nextWithdrawalIndex(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix => error.InvalidAtFork,
            inline else => |state| try state.get("next_withdrawal_index"),
        };
    }

    pub fn setNextWithdrawalIndex(self: *AnyBeaconState, next_withdrawal_index: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix => error.InvalidAtFork,
            inline else => |state| try state.set("next_withdrawal_index", next_withdrawal_index),
        };
    }

    pub fn nextWithdrawalValidatorIndex(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix => error.InvalidAtFork,
            inline else => |state| try state.get("next_withdrawal_validator_index"),
        };
    }

    pub fn setNextWithdrawalValidatorIndex(self: *AnyBeaconState, next_withdrawal_validator_index: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix => error.InvalidAtFork,
            inline else => |state| try state.set("next_withdrawal_validator_index", next_withdrawal_validator_index),
        };
    }

    pub fn historicalSummaries(self: *AnyBeaconState) !*ct.capella.HistoricalSummaries.TreeView {
        return switch (self.*) {
            .phase0, .altair, .bellatrix => error.InvalidAtFork,
            inline else => |state| try state.get("historical_summaries"),
        };
    }

    pub fn depositRequestsStartIndex(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("deposit_requests_start_index"),
        };
    }

    pub fn setDepositRequestsStartIndex(self: *AnyBeaconState, index: u64) !void {
        return switch (self.*) {
            .heze => return error.InvalidAtFork,
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("deposit_requests_start_index", index),
        };
    }

    pub fn depositBalanceToConsume(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("deposit_balance_to_consume"),
        };
    }

    pub fn setDepositBalanceToConsume(self: *AnyBeaconState, balance: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("deposit_balance_to_consume", balance),
        };
    }

    pub fn exitBalanceToConsume(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("exit_balance_to_consume"),
        };
    }

    pub fn setExitBalanceToConsume(self: *AnyBeaconState, balance: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("exit_balance_to_consume", balance),
        };
    }

    pub fn earliestExitEpoch(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("earliest_exit_epoch"),
        };
    }

    pub fn setEarliestExitEpoch(self: *AnyBeaconState, epoch: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("earliest_exit_epoch", epoch),
        };
    }

    pub fn consolidationBalanceToConsume(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("consolidation_balance_to_consume"),
        };
    }

    pub fn setConsolidationBalanceToConsume(self: *AnyBeaconState, balance: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("consolidation_balance_to_consume", balance),
        };
    }

    pub fn earliestConsolidationEpoch(self: *AnyBeaconState) !u64 {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.get("earliest_consolidation_epoch"),
        };
    }

    pub fn setEarliestConsolidationEpoch(self: *AnyBeaconState, epoch: u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb => error.InvalidAtFork,
            inline else => |state| try state.set("earliest_consolidation_epoch", epoch),
        };
    }

    pub fn pendingDeposits(self: *AnyBeaconState) !AnyStateList("pending_deposits") {
        return self.getListField("pending_deposits");
    }

    pub fn setPendingDeposits(self: *AnyBeaconState, deposits: AnyStateList("pending_deposits")) !void {
        return self.setListField("pending_deposits", deposits);
    }

    pub fn pendingPartialWithdrawals(self: *AnyBeaconState) !AnyStateList("pending_partial_withdrawals") {
        return self.getListField("pending_partial_withdrawals");
    }

    pub fn setPendingPartialWithdrawals(self: *AnyBeaconState, pending_partial_withdrawals: AnyStateList("pending_partial_withdrawals")) !void {
        return self.setListField("pending_partial_withdrawals", pending_partial_withdrawals);
    }

    pub fn pendingConsolidations(self: *AnyBeaconState) !AnyStateList("pending_consolidations") {
        return self.getListField("pending_consolidations");
    }

    pub fn setPendingConsolidations(self: *AnyBeaconState, consolidations: AnyStateList("pending_consolidations")) !void {
        return self.setListField("pending_consolidations", consolidations);
    }

    /// Get proposer_lookahead
    pub fn proposerLookahead(self: *AnyBeaconState) !*ct.fulu.ProposerLookahead.TreeView {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb, .electra => error.InvalidAtFork,
            inline else => |state| try state.get("proposer_lookahead"),
        };
    }

    /// Returns a read-only slice of proposer_lookahead values.
    /// Caller owns the returned slice and must free it with the same allocator.
    pub fn proposerLookaheadSlice(self: *AnyBeaconState, allocator: Allocator) !*[ct.fulu.ProposerLookahead.length]u64 {
        var lookahead_view = try self.proposerLookahead();
        return @ptrCast(try lookahead_view.getAll(allocator));
    }

    pub fn proposerLookaheadInto(self: *AnyBeaconState, out: *[ct.fulu.ProposerLookahead.length]u64) !void {
        var lookahead_view = try self.proposerLookahead();
        _ = try lookahead_view.getAllInto(out[0..]);
    }

    pub fn setProposerLookahead(self: *AnyBeaconState, proposer_lookahead: *const [ct.fulu.ProposerLookahead.length]u64) !void {
        return switch (self.*) {
            .phase0, .altair, .bellatrix, .capella, .deneb, .electra => error.InvalidAtFork,
            inline else => |state| try state.setValue("proposer_lookahead", proposer_lookahead),
        };
    }

    /// Copies fields of `AnyBeaconState` from type `F` to type `T`, provided they have the same field name.
    /// The cache of original state is cleared after the copy is complete.
    fn populateFields(
        comptime F: type,
        comptime T: type,
        allocator: Allocator,
        pool: *Node.Pool,
        state: *F.TreeView,
    ) !*T.TreeView {
        // first ensure that the source state is committed
        try state.commit();

        var upgraded = try T.TreeView.fromValue(allocator, pool, &T.default_value);
        errdefer upgraded.deinit();

        inline for (F.fields) |f| {
            if (comptime @hasField(T.Type, f.name)) {
                if (T.getFieldType(f.name) != f.type) {
                    // AnyBeaconState of prev_fork and cur_fork has the same field name but different types
                    // for example latest_execution_payload_header changed from Bellatrix to Capella
                    // In this case we just skip copying this field and leave it to caller to set properly
                    continue;
                }

                if (comptime isBasicType(f.type)) {
                    // For basic fields, get() returns a copy, so we can directly set it.
                    try upgraded.set(f.name, try state.get(f.name));
                } else {
                    // For composite fields, get() returns a borrowed *TreeView backed by state caches.
                    // Clone it to create an owned view, then transfer ownership to upgraded.
                    var field_view = try state.get(f.name);
                    var owned_field_view = try field_view.clone(.{ .transfer_cache = true });
                    errdefer owned_field_view.deinit();
                    try upgraded.set(f.name, owned_field_view);
                }
            }
        }

        try upgraded.commit();

        return upgraded;
    }

    /// Upgrade `self` from a certain fork to the next.
    /// Allocates a new `state` of the next fork, clones all fields of the current `state` to it and assigns `self` to it.
    /// Caller must make sure an upgrade is needed by checking BeaconConfig then free upgraded state.
    /// Caller needs to deinit the old state
    pub fn upgradeUnsafe(self: *AnyBeaconState) !AnyBeaconState {
        return switch (self.*) {
            .phase0 => |state| .{
                .altair = try populateFields(
                    ct.phase0.BeaconState,
                    ct.altair.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .altair => |state| .{
                .bellatrix = try populateFields(
                    ct.altair.BeaconState,
                    ct.bellatrix.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .bellatrix => |state| .{
                .capella = try populateFields(
                    ct.bellatrix.BeaconState,
                    ct.capella.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .capella => |state| .{
                .deneb = try populateFields(
                    ct.capella.BeaconState,
                    ct.deneb.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .deneb => |state| .{
                .electra = try populateFields(
                    ct.deneb.BeaconState,
                    ct.electra.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .electra => |state| .{
                .fulu = try populateFields(
                    ct.electra.BeaconState,
                    ct.fulu.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .fulu => |state| .{
                .gloas = try populateFields(
                    ct.fulu.BeaconState,
                    ct.gloas.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .gloas => |state| .{
                .heze = try populateFields(
                    ct.gloas.BeaconState,
                    ct.heze.BeaconState,
                    state.allocator,
                    state.pool,
                    state,
                ),
            },
            .heze => error.InvalidAtFork,
        };
    }
};

test {
    _ = @import("any_beacon_state_test.zig");
}
