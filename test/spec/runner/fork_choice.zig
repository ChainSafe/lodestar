//! Runner for https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/tests/formats/fork_choice/README.md
//!
//! The runner plays the part of the spec `Store` fields the Zig store does not hold:
//! `block_states` and `checkpoint_states`. It runs `state_transition`, indexes
//! attestations against checkpoint states and verifies envelopes, then hands the
//! results to `fork_choice.Store`.
//!
//! Not covered: `on_merge_block` (needs `get_pow_block`), KZG proof verification
//! (no KZG binding yet), and the `sync` runner (optimistic sync).

const std = @import("std");
const Allocator = std.mem.Allocator;
const yaml = @import("yaml");
const Node = @import("persistent_merkle_tree").Node;
const types = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const preset_root = @import("preset");
const preset = preset_root.preset;
const hex = @import("hex");
const constants = @import("constants");
const bls = @import("bls");
const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const fork_types = @import("fork_types");
const AnyBeaconBlock = fork_types.AnyBeaconBlock;
const AnyIndexedAttestation = fork_types.AnyIndexedAttestation;
const AnyAttesterSlashing = fork_types.AnyAttesterSlashing;
const fork_choice = @import("fork_choice");
const Store = fork_choice.Store;
const Checkpoint = fork_choice.Checkpoint;
const PayloadStatus = fork_choice.PayloadStatus;
const test_case = @import("../test_case.zig");
const loadSszValue = test_case.loadSszSnappyValue;

const Root = [32]u8;
const BYTES_PER_BLOB = constants.BYTES_PER_FIELD_ELEMENT * preset.FIELD_ELEMENTS_PER_BLOB;

/// Handlers of the `fork_choice` runner found in the v1.7.0-beta.4 vectors.
pub const Handler = enum {
    deposit_with_reorg,
    ex_ante,
    filter_node_tree_variants,
    get_head,
    get_parent_payload_status,
    get_proposer_head,
    on_attestation,
    on_block,
    on_execution_payload_envelope,
    on_payload_attestation_message,
    payload_data_availability,
    payload_timeliness,
    reorg,
    should_apply_proposer_boost,
    withholding,

    pub fn suiteName(self: Handler) []const u8 {
        return @tagName(self) ++ "/pyspec_tests";
    }
};

const RootContext = struct {
    pub fn hash(_: RootContext, key: Root) u64 {
        return std.mem.readInt(u64, key[0..8], .little);
    }

    pub fn eql(_: RootContext, a: Root, b: Root) bool {
        return std.mem.eql(u8, &a, &b);
    }
};

const CheckpointContext = struct {
    pub fn hash(_: CheckpointContext, key: Checkpoint) u64 {
        return std.mem.readInt(u64, key.root[0..8], .little) ^ key.epoch;
    }

    pub fn eql(_: CheckpointContext, a: Checkpoint, b: Checkpoint) bool {
        return a.epoch == b.epoch and std.mem.eql(u8, &a.root, &b.root);
    }
};

const BlockStates = std.HashMapUnmanaged(Root, *CachedBeaconState, RootContext, 80);

/// Spec test `on_payload_info`: what the execution engine mock answers for a payload.
const PayloadVerdict = struct {
    status: Status,
    latest_valid_hash: ?Root,

    const Status = enum { valid, invalid, syncing, accepted, invalid_block_hash };
    const names = std.StaticStringMap(Status).initComptime(.{
        .{ "VALID", .valid },
        .{ "INVALID", .invalid },
        .{ "SYNCING", .syncing },
        .{ "ACCEPTED", .accepted },
        .{ "INVALID_BLOCK_HASH", .invalid_block_hash },
    });
};
const PayloadVerdicts = std.HashMapUnmanaged(Root, PayloadVerdict, RootContext, 80);
const CheckpointStates = std.HashMapUnmanaged(Checkpoint, *CachedBeaconState, CheckpointContext, 80);

fn anyBlockVariant(comptime fork: ForkSeq) []const u8 {
    return switch (fork) {
        .phase0 => "phase0",
        .altair => "altair",
        else => "full_" ++ @tagName(fork),
    };
}

fn anyIndexedAttestationVariant(comptime fork: ForkSeq) []const u8 {
    return if (fork.lt(.electra)) "phase0" else if (fork.lt(.gloas)) "electra" else "gloas";
}

pub fn TestCase(comptime fork: ForkSeq) type {
    const ForkTypes = @field(types, fork.name());
    const tc_utils = test_case.TestCaseUtils(fork);

    return struct {
        allocator: Allocator,
        io: std.Io,
        dir: std.Io.Dir,
        bls_setting: test_case.BlsSetting,
        options: Options,
        anchor: TestCachedBeaconState,
        anchor_block: *ForkTypes.BeaconBlock.Type,
        block_states: BlockStates,
        checkpoint_states: CheckpointStates,
        payload_verdicts: PayloadVerdicts,
        store: Store,
        fast_confirmation: fork_choice.FastConfirmation,

        const Self = @This();

        pub const Options = struct {
            /// The compliance generators suppress assertion faults from a valid block's own
            /// attestations and attester slashings (`_add_block` in
            /// tests/generators/compliance_runners/fork_choice/instantiators/helpers.py);
            /// the regular `fork_choice` vectors require them to succeed.
            suppress_block_message_faults: bool = false,
        };

        pub fn execute(allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir, options: Options) !void {
            var self: Self = undefined;
            self.options = options;
            try self.init(allocator, pool, dir);
            defer {
                self.deinit();
                state_transition.deinitReusedEpochTransitionCache();
            }
            try self.run();
        }

        fn init(self: *Self, allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir) !void {
            self.allocator = allocator;
            self.io = std.testing.io;
            self.dir = dir;
            self.bls_setting = try test_case.loadBlsSetting(allocator, dir);
            self.block_states = .empty;
            self.checkpoint_states = .empty;
            self.payload_verdicts = .empty;

            self.anchor = try tc_utils.loadCachedState(allocator, pool, dir, "anchor_state.ssz_snappy");
            errdefer self.anchor.deinit();

            self.anchor_block = try allocator.create(ForkTypes.BeaconBlock.Type);
            errdefer allocator.destroy(self.anchor_block);
            self.anchor_block.* = ForkTypes.BeaconBlock.default_value;
            try loadSszValue(ForkTypes.BeaconBlock, allocator, dir, "anchor_block.ssz_snappy", self.anchor_block);
            errdefer ForkTypes.BeaconBlock.deinit(allocator, self.anchor_block);

            const block = @unionInit(AnyBeaconBlock, anyBlockVariant(fork), self.anchor_block);
            var anchor_root: Root = undefined;
            try block.hashTreeRoot(allocator, &anchor_root);
            errdefer self.block_states.deinit(allocator);
            try self.block_states.put(allocator, anchor_root, self.anchor.cached_state);

            self.store = try Store.init(allocator, self.anchor.config, self.anchor.cached_state, block, .valid, self.stateProvider());
            self.fast_confirmation = .init(&self.store);
        }

        fn deinit(self: *Self) void {
            self.store.deinit();
            var block_it = self.block_states.valueIterator();
            while (block_it.next()) |state| {
                if (state.* == self.anchor.cached_state) continue;
                state.*.deinit();
                self.allocator.destroy(state.*);
            }
            self.block_states.deinit(self.allocator);
            var checkpoint_it = self.checkpoint_states.valueIterator();
            while (checkpoint_it.next()) |state| {
                state.*.deinit();
                self.allocator.destroy(state.*);
            }
            self.checkpoint_states.deinit(self.allocator);
            self.payload_verdicts.deinit(self.allocator);
            ForkTypes.BeaconBlock.deinit(self.allocator, self.anchor_block);
            self.allocator.destroy(self.anchor_block);
            self.anchor.deinit();
        }

        // --- state provider -----------------------------------------------------------

        fn stateProvider(self: *Self) fork_choice.StateProvider {
            return .{ .ctx = self, .vtable = &provider_vtable };
        }

        const provider_vtable: fork_choice.StateProvider.VTable = .{
            .justifiedBalances = justifiedBalances,
            .slotCommitteeMembers = slotCommitteeMembers,
            .checkpointBalanceSource = checkpointBalanceSource,
            .pulledUpBalanceSource = pulledUpBalanceSource,
        };

        fn checkpointBalanceSource(ctx: *anyopaque, allocator: Allocator, checkpoint: Checkpoint) anyerror!fork_choice.BalanceSource {
            const self: *Self = @ptrCast(@alignCast(ctx));
            return balanceSource(allocator, try self.getCheckpointState(checkpoint));
        }

        /// Spec `get_pulled_up_head_state`: the same state as `store_target_checkpoint_state`
        /// for the head's checkpoint of `epoch`.
        fn pulledUpBalanceSource(ctx: *anyopaque, allocator: Allocator, root: Root, epoch: u64) anyerror!fork_choice.BalanceSource {
            const self: *Self = @ptrCast(@alignCast(ctx));
            return balanceSource(allocator, try self.getCheckpointState(.{ .epoch = epoch, .root = root }));
        }

        fn balanceSource(allocator: Allocator, state: *CachedBeaconState) !fork_choice.BalanceSource {
            const validator_count = try state.state.validatorsCount();
            const increments = try allocator.dupe(u16, state.epoch_cache.getEffectiveBalanceIncrements().items[0..validator_count]);
            errdefer allocator.free(increments);
            var active = try std.DynamicBitSetUnmanaged.initEmpty(allocator, validator_count);
            errdefer active.deinit(allocator);
            var slashed = try std.DynamicBitSetUnmanaged.initEmpty(allocator, validator_count);
            errdefer slashed.deinit(allocator);
            for (state.epoch_cache.getCurrentShuffling().active_indices) |index| active.set(index);
            const validators = try state.state.validatorsPtrSlice(allocator);
            defer allocator.free(validators);
            for (validators, 0..) |validator, index| {
                if (validator.slashed) slashed.set(index);
            }
            return .{ .effective_balance_increments = increments, .active = active, .slashed = slashed };
        }

        fn justifiedBalances(ctx: *anyopaque, allocator: Allocator, checkpoint: Checkpoint) anyerror!fork_choice.JustifiedBalances {
            const self: *Self = @ptrCast(@alignCast(ctx));
            const state = try self.getCheckpointState(checkpoint);
            const validator_count = try state.state.validatorsCount();
            const increments = try allocator.dupe(u16, state.epoch_cache.getEffectiveBalanceIncrements().items[0..validator_count]);
            errdefer allocator.free(increments);
            var active_unslashed = try std.DynamicBitSetUnmanaged.initEmpty(allocator, validator_count);
            errdefer active_unslashed.deinit(allocator);
            const validators = try state.state.validatorsPtrSlice(allocator);
            defer allocator.free(validators);
            for (state.epoch_cache.getCurrentShuffling().active_indices) |index| {
                if (!validators[index].slashed) active_unslashed.set(index);
            }
            return .{ .effective_balance_increments = increments, .active_unslashed = active_unslashed };
        }

        fn slotCommitteeMembers(ctx: *anyopaque, allocator: Allocator, root: Root, slot: u64, out: *std.ArrayList(u64)) anyerror!void {
            const self: *Self = @ptrCast(@alignCast(ctx));
            const state = self.block_states.get(root) orelse return error.UnknownBlock;
            const epoch = state_transition.computeEpochAtSlot(slot);
            const committee_count = try state.epoch_cache.getCommitteeCountPerSlot(epoch);
            for (0..committee_count) |index| {
                for (try state.epoch_cache.getBeaconCommittee(slot, index)) |member| try out.append(allocator, member);
            }
        }

        /// Spec `store_target_checkpoint_state`.
        fn getCheckpointState(self: *Self, checkpoint: Checkpoint) !*CachedBeaconState {
            if (self.checkpoint_states.get(checkpoint)) |state| return state;
            const base = self.block_states.get(checkpoint.root) orelse return error.UnknownCheckpointRoot;
            const state = try base.clone(self.allocator, .{ .transfer_cache = false });
            errdefer {
                state.deinit();
                self.allocator.destroy(state);
            }
            const start_slot = state_transition.computeStartSlotAtEpoch(checkpoint.epoch);
            if (try state.state.slot() < start_slot) {
                try state_transition.processSlots(self.allocator, self.io, state, start_slot, null);
            }
            try self.checkpoint_states.put(self.allocator, checkpoint, state);
            return state;
        }

        // --- steps --------------------------------------------------------------------

        fn run(self: *Self) !void {
            const contents = try self.dir.readFileAlloc(self.io, "steps.yaml", self.allocator, .limited(64 * 1024 * 1024));
            defer self.allocator.free(contents);
            var arena = std.heap.ArenaAllocator.init(self.allocator);
            defer arena.deinit();
            var document = yaml.Yaml{ .source = contents };
            try document.load(arena.allocator());
            if (document.docs.items.len != 1) return error.InvalidSteps;
            const steps = try document.docs.items[0].asList();

            for (steps, 0..) |step_value, i| {
                const step = try step_value.asMap();
                const valid = if (step.get("valid")) |v| try parseBool(v) else true;
                if (step.get("tick")) |tick| {
                    const seconds = try parseU64(tick);
                    try self.expectOutcome(i, "tick", valid, self.store.onTick(fork_choice.store.secondsToMilliseconds(seconds)));
                } else if (step.get("block")) |name| {
                    try self.expectOutcome(i, "block", valid, self.runBlock(step, try name.asScalar()));
                } else if (step.get("attestation")) |name| {
                    try self.expectOutcome(i, "attestation", valid, self.runAttestation(try name.asScalar()));
                } else if (step.get("attester_slashing")) |name| {
                    try self.expectOutcome(i, "attester_slashing", valid, self.runAttesterSlashing(try name.asScalar()));
                } else if (step.get("payload_attestation_message")) |name| {
                    try self.expectOutcome(i, "payload_attestation_message", valid, self.runPayloadAttestationMessage(try name.asScalar()));
                } else if (step.get("execution_payload")) |name| {
                    try self.expectOutcome(i, "execution_payload", valid, self.runExecutionPayload(try name.asScalar()));
                } else if (step.get("block_hash")) |hash| {
                    try self.recordPayloadVerdict(try parseRoot(hash), try (step.get("payload_status") orelse return error.InvalidSteps).asMap());
                } else if (step.get("checks")) |checks| {
                    self.runChecks(try checks.asMap()) catch |err| {
                        std.debug.print("fork_choice step {d}: checks failed: {s}\n", .{ i, @errorName(err) });
                        return err;
                    };
                } else {
                    std.debug.print("fork_choice step {d}: unsupported step\n", .{i});
                    return error.UnsupportedStep;
                }
            }
            try self.checkPruneKeepsHead();
        }

        /// Not part of the spec flow: the spec store never prunes, so pruning runs once all
        /// steps are done, where dropping the blocks outside the finalized subtree must not
        /// move the head.
        fn checkPruneKeepsHead(self: *Self) !void {
            const before = try self.store.getHead();
            const before_root = self.store.blockRoot(before.block);
            _ = try self.store.prune();
            const after = try self.store.getHead();
            try expectRoot(before_root, self.store.blockRoot(after.block), "head after prune");
            try expectEqual(u8, @intFromEnum(before.payload_status), @intFromEnum(after.payload_status), "head payload status after prune");
        }

        fn recordPayloadVerdict(self: *Self, block_hash: Root, status: yaml.Yaml.Map) !void {
            const name = try (status.get("status") orelse return error.InvalidSteps).asScalar();
            const kind = PayloadVerdict.names.get(name) orelse return error.UnknownPayloadStatus;
            const latest_valid_hash = if (status.get("latest_valid_hash")) |value| try parseOptionalRoot(value) else null;
            try self.payload_verdicts.put(self.allocator, block_hash, .{ .status = kind, .latest_valid_hash = latest_valid_hash });
        }

        /// The engine mock's verdict on the block's payload. Vectors without one assume
        /// `VALID`; Gloas payloads arrive with their envelope. `INVALID` rejects the block
        /// and invalidates its ancestors down to `latest_valid_hash`, as block import does.
        fn executionStatus(self: *Self, block: AnyBeaconBlock) !fork_choice.ExecutionStatus {
            if (comptime fork.lt(.bellatrix)) return .valid;
            if (comptime fork.gte(.gloas)) return .syncing;
            const payload = try block.beaconBlockBody().executionPayload();
            const verdict = self.payload_verdicts.get(payload.blockHash().*) orelse return .valid;
            switch (verdict.status) {
                .valid => return .valid,
                .syncing, .accepted => return .syncing,
                .invalid => {
                    try self.store.onPayloadInvalid(block.parentRoot().*, payload.parentHash().*, verdict.latest_valid_hash);
                    return error.InvalidExecutionPayload;
                },
                .invalid_block_hash => return error.InvalidExecutionPayload,
            }
        }

        fn expectOutcome(self: *Self, index: usize, kind: []const u8, valid: bool, result: anyerror!void) !void {
            _ = self;
            if (result) |_| {
                if (!valid) {
                    std.debug.print("fork_choice step {d} ({s}): expected rejection\n", .{ index, kind });
                    return error.ExpectedError;
                }
            } else |err| {
                if (valid) {
                    std.debug.print("fork_choice step {d} ({s}): unexpected {s}\n", .{ index, kind, @errorName(err) });
                    return err;
                }
                try test_case.expectConsensusInvalid(err);
            }
        }

        fn fileName(self: *Self, name: []const u8) ![]u8 {
            return std.fmt.allocPrint(self.allocator, "{s}.ssz_snappy", .{name});
        }

        /// Spec test `on_block` step: `on_block` plus the block's attestations and
        /// attester slashings. Payload attestations are fed by `Store.onBlock` itself.
        fn runBlock(self: *Self, step: yaml.Yaml.Map, name: []const u8) !void {
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            const signed = try test_case.loadSignedBeaconBlock(self.allocator, fork, self.dir, file);
            defer test_case.deinitSignedBeaconBlock(signed, self.allocator);
            const block = signed.beaconBlock();
            var root: Root = undefined;
            try block.hashTreeRoot(self.allocator, &root);
            if (self.store.hasBlock(root)) return;

            try self.checkDataAvailability(step, block, root);
            try self.store.validateBlock(block, root);
            const execution_status = try self.executionStatus(block);
            const parent_state = self.block_states.get(block.parentRoot().*) orelse return error.UnknownParent;
            const verify = self.bls_setting.verify();
            try self.block_states.ensureUnusedCapacity(self.allocator, 1);
            const post_state = try state_transition.stateTransition(self.allocator, self.io, parent_state, signed, .{
                .verify_signatures = verify,
                .verify_proposer = verify,
                .verify_state_root = true,
                .transfer_cache = false,
            }, null);
            {
                errdefer {
                    post_state.deinit();
                    self.allocator.destroy(post_state);
                }
                try self.store.onBlock(block, root, post_state, execution_status);
            }
            self.block_states.putAssumeCapacity(root, post_state);

            const body = &block.castToFork(.full, fork).body().inner;
            for (body.attestations.items) |*attestation| {
                self.processAttestation(attestation, true) catch |err| try self.blockMessageFault(err);
            }
            for (body.attester_slashings.items) |*slashing| {
                self.processAttesterSlashing(slashing) catch |err| try self.blockMessageFault(err);
            }
        }

        fn blockMessageFault(self: *Self, err: anyerror) !void {
            if (!self.options.suppress_block_message_faults) return err;
            try test_case.expectConsensusInvalid(err);
        }

        /// Spec `is_data_available` as far as the vectors can be checked without KZG.
        fn checkDataAvailability(self: *Self, step: yaml.Yaml.Map, block: AnyBeaconBlock, root: Root) !void {
            if (comptime fork.gte(.deneb) and fork.lt(.fulu)) {
                const commitments = block.castToFork(.full, fork).body().inner.blob_kzg_commitments.items.len;
                const blobs = if (step.get("blobs")) |blobs| try self.loadBlobCount(try blobs.asScalar()) else 0;
                const proofs = if (step.get("proofs")) |proofs| (try proofs.asList()).len else 0;
                if (blobs != commitments or proofs != commitments) return error.DataUnavailable;
            } else if (comptime fork.gte(.fulu) and fork.lt(.gloas)) {
                const columns = step.get("columns") orelse return;
                const names = try columns.asList();
                if (names.len == 0) return error.DataUnavailable;
                const commitments = block.castToFork(.full, fork).body().inner.blob_kzg_commitments.items.len;
                if (commitments == 0) return error.DataUnavailable;
                for (names) |column_name| try self.checkColumnSidecar(try column_name.asScalar(), root, commitments);
            }
        }

        fn loadBlobCount(self: *Self, name: []const u8) !usize {
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            const compressed = try self.dir.readFileAlloc(self.io, file, self.allocator, .unlimited);
            defer self.allocator.free(compressed);
            const length = try @import("snappy").raw.uncompressedLength(compressed);
            if (length % BYTES_PER_BLOB != 0) return error.InvalidBlobsFile;
            return length / BYTES_PER_BLOB;
        }

        /// Spec `verify_data_column_sidecar` minus the KZG proof batch.
        fn checkColumnSidecar(self: *Self, name: []const u8, block_root: Root, commitments: usize) !void {
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            var sidecar = types.fulu.DataColumnSidecar.default_value;
            try loadSszValue(types.fulu.DataColumnSidecar, self.allocator, self.dir, file, &sidecar);
            defer types.fulu.DataColumnSidecar.deinit(self.allocator, &sidecar);
            if (sidecar.index >= preset_root.NUMBER_OF_COLUMNS) return error.DataUnavailable;
            const column_len = sidecar.column.items.len;
            if (column_len == 0 or column_len != sidecar.kzg_commitments.items.len or column_len != sidecar.kzg_proofs.items.len) return error.DataUnavailable;
            if (column_len != commitments) return error.DataUnavailable;
            var header_root: Root = undefined;
            try types.phase0.BeaconBlockHeader.hashTreeRoot(&sidecar.signed_block_header.message, &header_root);
            if (!std.mem.eql(u8, &header_root, &block_root)) return error.DataUnavailable;
        }

        fn runAttestation(self: *Self, name: []const u8) !void {
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            var attestation = ForkTypes.Attestation.default_value;
            try loadSszValue(ForkTypes.Attestation, self.allocator, self.dir, file, &attestation);
            defer ForkTypes.Attestation.deinit(self.allocator, &attestation);
            try self.processAttestation(&attestation, false);
        }

        /// Spec `on_attestation`: validation, target checkpoint state, indexing, then the store.
        fn processAttestation(self: *Self, attestation: *const ForkTypes.Attestation.Type, is_from_block: bool) !void {
            const data = attestation.data;
            try self.store.validateOnAttestation(&data, is_from_block);
            const target_state = try self.getCheckpointState(data.target);
            var indices = try target_state.epoch_cache.getAttestingIndices(fork, self.allocator, attestation);
            defer indices.deinit(self.allocator);
            std.mem.sort(u64, indices.items, {}, std.sort.asc(u64));
            var indexed = ForkTypes.IndexedAttestation.default_value;
            indexed.attesting_indices = indices;
            indexed.data = data;
            indexed.signature = attestation.signature;
            const validator_count = try target_state.state.validatorsCount();
            const valid = try state_transition.isValidIndexedAttestation(
                fork,
                self.allocator,
                self.io,
                target_state.config,
                target_state.epoch_cache,
                validator_count,
                &indexed,
                self.bls_setting.verify(),
            );
            if (!valid) return error.InvalidIndexedAttestation;
            const any = @unionInit(AnyIndexedAttestation, anyIndexedAttestationVariant(fork), &indexed);
            try self.store.onAttestation(any, is_from_block);
        }

        fn runAttesterSlashing(self: *Self, name: []const u8) !void {
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            var slashing = ForkTypes.AttesterSlashing.default_value;
            try loadSszValue(ForkTypes.AttesterSlashing, self.allocator, self.dir, file, &slashing);
            defer ForkTypes.AttesterSlashing.deinit(self.allocator, &slashing);
            try self.processAttesterSlashing(&slashing);
        }

        /// Spec `on_attester_slashing`: both attestations verified against the justified state.
        fn processAttesterSlashing(self: *Self, slashing: *ForkTypes.AttesterSlashing.Type) !void {
            const justified_state = self.block_states.get(self.store.justified_checkpoint.root) orelse return error.UnknownJustifiedRoot;
            const validator_count = try justified_state.state.validatorsCount();
            for ([_]*const ForkTypes.IndexedAttestation.Type{ &slashing.attestation_1, &slashing.attestation_2 }) |attestation| {
                const valid = try state_transition.isValidIndexedAttestation(
                    fork,
                    self.allocator,
                    self.io,
                    justified_state.config,
                    justified_state.epoch_cache,
                    validator_count,
                    attestation,
                    self.bls_setting.verify(),
                );
                if (!valid) return error.InvalidIndexedAttestation;
            }
            const any = @unionInit(AnyAttesterSlashing, anyIndexedAttestationVariant(fork), slashing);
            try self.store.onAttesterSlashing(any);
        }

        fn runPayloadAttestationMessage(self: *Self, name: []const u8) !void {
            if (comptime fork.lt(.gloas)) return error.UnsupportedStep;
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            var message: ForkTypes.PayloadAttestationMessage.Type = undefined;
            try loadSszValue(ForkTypes.PayloadAttestationMessage, self.allocator, self.dir, file, &message);
            const data = &message.data;
            const state = self.block_states.get(data.beacon_block_root) orelse return error.UnknownBlock;
            if (data.slot != try state.state.slot()) return;
            var ptc: ForkTypes.PayloadTimelinessCommittee.Type = undefined;
            try state_transition.getPayloadTimelinessCommittee(fork, state.config, state.state.castToFork(fork), data.slot, &ptc);
            var positions: fork_choice.store.PtcPositions = .{};
            try self.store.validatePayloadAttestationMessage(data, message.validator_index, &ptc, false, &positions);
            if (self.bls_setting.verify()) {
                var indices = [_]u64{message.validator_index};
                var indexed = ForkTypes.IndexedPayloadAttestation.default_value;
                indexed.attesting_indices = .initBuffer(&indices);
                indexed.attesting_indices.items.len = 1;
                indexed.data = data.*;
                indexed.signature = message.signature;
                const valid = try state_transition.isValidIndexedPayloadAttestation(fork, self.io, state.config, state.epoch_cache, &indexed, true);
                if (!valid) return error.InvalidPayloadAttestationSignature;
            }
            try self.store.onPayloadAttestationMessage(data, message.validator_index, &ptc, false);
        }

        fn runExecutionPayload(self: *Self, name: []const u8) !void {
            if (comptime fork.lt(.gloas)) return error.UnsupportedStep;
            const file = try self.fileName(name);
            defer self.allocator.free(file);
            var signed = ForkTypes.SignedExecutionPayloadEnvelope.default_value;
            try loadSszValue(ForkTypes.SignedExecutionPayloadEnvelope, self.allocator, self.dir, file, &signed);
            defer ForkTypes.SignedExecutionPayloadEnvelope.deinit(self.allocator, &signed);
            const root = signed.message.beacon_block_root;
            const state = self.block_states.get(root) orelse return error.UnknownBlock;
            try self.verifyExecutionPayloadEnvelope(state, &signed);
            try self.store.onExecutionPayloadEnvelope(root, .valid, if (comptime fork.gte(.heze)) true else null);
        }

        /// Spec `verify_execution_payload_envelope` without the execution engine call.
        fn verifyExecutionPayloadEnvelope(self: *Self, state: *CachedBeaconState, signed: *const ForkTypes.SignedExecutionPayloadEnvelope.Type) !void {
            if (comptime fork.lt(.gloas)) unreachable;
            const envelope = &signed.message;
            const payload = &envelope.payload;
            const typed = state.state.castToFork(fork);
            const state_slot = try state.state.slot();

            if (self.bls_setting.verify()) {
                const pubkey = if (envelope.builder_index == constants.BUILDER_INDEX_SELF_BUILD) blk: {
                    var latest_block_header = try state.state.latestBlockHeader();
                    const proposer_index = try latest_block_header.get("proposer_index");
                    break :blk state.epoch_cache.pubkey_cache.getPubkey(self.io, proposer_index) orelse return error.UnknownProposer;
                } else blk: {
                    var builders = try typed.inner.getReadonly("builders");
                    var builder: ForkTypes.Builder.Type = undefined;
                    try builders.getValue(self.allocator, envelope.builder_index, &builder);
                    break :blk bls.PublicKey.uncompress(&builder.pubkey) catch return error.InvalidBuilderPubkey;
                };
                const domain = try state.config.getDomain(state_transition.computeEpochAtSlot(state_slot), constants.DOMAIN_BEACON_BUILDER, null);
                var object_root: Root = undefined;
                try ForkTypes.ExecutionPayloadEnvelope.hashTreeRoot(self.allocator, envelope, &object_root);
                var signing_root: Root = undefined;
                try state_transition.computeSigningRoot(types.primitive.Root, &object_root, domain, &signing_root);
                const signature = bls.Signature.uncompress(&signed.signature) catch return error.InvalidEnvelopeSignature;
                state_transition.bls.verify(&signing_root, &pubkey, &signature, .{ .sig_groupcheck = true, .pk_validate = true }) catch return error.InvalidEnvelopeSignature;
            }

            var header: types.phase0.BeaconBlockHeader.Type = undefined;
            var latest_block_header = try state.state.latestBlockHeader();
            try latest_block_header.toValue(undefined, &header);
            header.state_root = (try state.state.hashTreeRoot()).*;
            var header_root: Root = undefined;
            try types.phase0.BeaconBlockHeader.hashTreeRoot(&header, &header_root);
            if (!std.mem.eql(u8, &header_root, &envelope.beacon_block_root)) return error.EnvelopeBlockRootMismatch;
            if (!std.mem.eql(u8, &envelope.parent_beacon_block_root, &header.parent_root)) return error.EnvelopeParentRootMismatch;

            var bid = ForkTypes.ExecutionPayloadBid.default_value;
            defer ForkTypes.ExecutionPayloadBid.deinit(self.allocator, &bid);
            try typed.inner.getValue(self.allocator, "latest_execution_payload_bid", &bid);
            if (envelope.builder_index != bid.builder_index) return error.EnvelopeBuilderMismatch;
            if (!std.mem.eql(u8, &payload.prev_randao, &bid.prev_randao)) return error.EnvelopePrevRandaoMismatch;
            if (payload.gas_limit != bid.gas_limit) return error.EnvelopeGasLimitMismatch;
            if (!std.mem.eql(u8, &payload.block_hash, &bid.block_hash)) return error.EnvelopeBlockHashMismatch;
            var requests_root: Root = undefined;
            try ForkTypes.ExecutionRequests.hashTreeRoot(self.allocator, &envelope.execution_requests, &requests_root);
            if (!std.mem.eql(u8, &requests_root, &bid.execution_requests_root)) return error.EnvelopeRequestsMismatch;

            if (payload.slot_number != state_slot) return error.EnvelopeSlotMismatch;
            const latest_block_hash = try typed.inner.getFieldRoot("latest_block_hash");
            if (!std.mem.eql(u8, &payload.parent_hash, latest_block_hash)) return error.EnvelopeParentHashMismatch;
            if (payload.timestamp != self.store.timing.timeAtSlotMs(state_slot) / 1000) return error.EnvelopeTimestampMismatch;
            var withdrawals_root: Root = undefined;
            try ForkTypes.Withdrawals.hashTreeRoot(self.allocator, &payload.withdrawals, &withdrawals_root);
            const expected_withdrawals_root = try typed.inner.getFieldRoot("payload_expected_withdrawals");
            if (!std.mem.eql(u8, &withdrawals_root, expected_withdrawals_root)) return error.EnvelopeWithdrawalsMismatch;
        }

        // --- checks -------------------------------------------------------------------

        fn runChecks(self: *Self, checks: yaml.Yaml.Map) !void {
            // The fast_confirmation generator runs `on_fast_confirmation` right before each
            // check that reports its store.
            if (checks.get("confirmed_root") != null) try self.fast_confirmation.onFastConfirmation(&self.store);
            if (checks.get("head")) |value| {
                const expected = try value.asMap();
                const head = try self.store.getHead();
                try expectEqual(u64, try parseU64(expected.get("slot") orelse return error.InvalidCheck), self.store.blockSlot(head.block), "head slot");
                try expectRoot(try parseRoot(expected.get("root") orelse return error.InvalidCheck), self.store.blockRoot(head.block), "head root");
                if (expected.get("payload_status")) |status| {
                    try expectEqual(u64, try parseU64(status), @intFromEnum(head.payload_status), "head payload status");
                }
            }
            if (checks.get("time")) |value| {
                try expectEqual(u64, try parseU64(value), self.store.time_ms / 1000, "time");
            }
            if (checks.get("genesis_time")) |value| {
                try expectEqual(u64, try parseU64(value), self.store.genesis_time_ms / 1000, "genesis time");
            }
            if (checks.get("justified_checkpoint")) |value| {
                try expectCheckpoint(try parseCheckpoint(value), self.store.justified_checkpoint, "justified checkpoint");
            }
            if (checks.get("finalized_checkpoint")) |value| {
                try expectCheckpoint(try parseCheckpoint(value), self.store.finalized_checkpoint, "finalized checkpoint");
            }
            if (checks.get("proposer_boost_root")) |value| {
                try expectRoot(try parseRoot(value), self.store.proposer_boost_root, "proposer boost root");
            }
            if (checks.get("get_proposer_head")) |value| {
                const head = try self.store.getHead();
                const proposer_head = try fork_choice.proposer_head.getProposerHead(&self.store, head, self.store.currentSlot());
                try expectRoot(try parseRoot(value), self.store.blockRoot(proposer_head.block), "proposer head");
            }
            if (checks.get("viable_for_head_roots_and_weights")) |value| {
                try self.checkViableHeads(try value.asList());
            }
            if (checks.get("payload_timeliness_vote")) |value| {
                try self.checkPtcVotes(try value.asMap(), .payload_present);
            }
            if (checks.get("payload_data_availability_vote")) |value| {
                try self.checkPtcVotes(try value.asMap(), .blob_data_available);
            }
            try self.checkFastConfirmation(checks);
        }

        fn checkFastConfirmation(self: *Self, checks: yaml.Yaml.Map) !void {
            const fcr = &self.fast_confirmation;
            const checkpoints = [_]struct { []const u8, Checkpoint }{
                .{ "previous_epoch_observed_justified_checkpoint", fcr.previous_epoch_observed_justified_checkpoint },
                .{ "current_epoch_observed_justified_checkpoint", fcr.current_epoch_observed_justified_checkpoint },
                .{ "previous_epoch_greatest_unrealized_checkpoint", fcr.previous_epoch_greatest_unrealized_checkpoint },
            };
            for (checkpoints) |entry| {
                if (checks.get(entry[0])) |value| try expectCheckpoint(try parseCheckpoint(value), entry[1], entry[0]);
            }
            const roots = [_]struct { []const u8, Root }{
                .{ "previous_slot_head", fcr.previous_slot_head },
                .{ "current_slot_head", fcr.current_slot_head },
                .{ "confirmed_root", fcr.confirmed_root },
            };
            for (roots) |entry| {
                if (checks.get(entry[0])) |value| try expectRoot(try parseRoot(value), entry[1], entry[0]);
            }
            if (checks.get("safe_execution_block_hash")) |value| {
                const hash = fcr.safeExecutionBlockHash(&self.store) orelse return error.UnknownBlock;
                try expectRoot(try parseRoot(value), hash, "safe execution block hash");
            }
        }

        fn checkViableHeads(self: *Self, expected: yaml.Yaml.List) !void {
            const actual = try self.store.viableHeads(self.allocator);
            defer self.allocator.free(actual);
            if (actual.len != expected.len) {
                std.debug.print("viable heads: expected {d} entries, got {d}\n", .{ expected.len, actual.len });
                return error.ViableHeadsMismatch;
            }
            for (expected) |entry_value| {
                const entry = try entry_value.asMap();
                const root = try parseRoot(entry.get("root") orelse return error.InvalidCheck);
                const weight = try parseU64(entry.get("weight") orelse return error.InvalidCheck);
                const status: ?u64 = if (entry.get("payload_status")) |s| try parseU64(s) else null;
                var found = false;
                for (actual) |head| {
                    if (!std.mem.eql(u8, &head.root, &root)) continue;
                    if (status) |s| {
                        if (s != @intFromEnum(head.payload_status)) continue;
                    }
                    found = true;
                    try expectEqual(u64, weight, head.weight, "viable head weight");
                }
                if (!found) {
                    std.debug.print("viable heads: missing root 0x{x}\n", .{root});
                    return error.ViableHeadsMismatch;
                }
            }
        }

        const PtcVoteField = enum { payload_present, blob_data_available };

        fn checkPtcVotes(self: *Self, expected: yaml.Yaml.Map, field: PtcVoteField) !void {
            const root = try parseRoot(expected.get("block_root") orelse return error.InvalidCheck);
            const votes = try (expected.get("votes") orelse return error.InvalidCheck).asList();
            const block = self.store.blockIndex(root) orelse return error.UnknownBlock;
            const actual = &self.store.ptc_votes.items[block];
            if (votes.len != actual.len) return error.PtcVotesMismatch;
            for (votes, actual, 0..) |vote, actual_vote, i| {
                const expected_vote = try parseOptionalBool(vote);
                const actual_value: ?bool = if (!actual_vote.voted) null else switch (field) {
                    .payload_present => actual_vote.payload_present,
                    .blob_data_available => actual_vote.blob_data_available,
                };
                if (expected_vote != actual_value) {
                    std.debug.print("ptc vote {d}: expected {?}, got {?}\n", .{ i, expected_vote, actual_value });
                    return error.PtcVotesMismatch;
                }
            }
        }
    };
}

fn expectEqual(comptime T: type, expected: T, actual: T, what: []const u8) !void {
    if (expected != actual) {
        std.debug.print("{s}: expected {any}, got {any}\n", .{ what, expected, actual });
        return error.CheckFailed;
    }
}

fn expectRoot(expected: Root, actual: Root, what: []const u8) !void {
    if (!std.mem.eql(u8, &expected, &actual)) {
        std.debug.print("{s}: expected 0x{x}, got 0x{x}\n", .{ what, expected, actual });
        return error.CheckFailed;
    }
}

fn expectCheckpoint(expected: Checkpoint, actual: Checkpoint, what: []const u8) !void {
    try expectEqual(u64, expected.epoch, actual.epoch, what);
    try expectRoot(expected.root, actual.root, what);
}

fn parseU64(value: yaml.Yaml.Value) !u64 {
    return std.fmt.parseInt(u64, try value.asScalar(), 10);
}

fn parseBool(value: yaml.Yaml.Value) !bool {
    const scalar = try value.asScalar();
    if (std.mem.eql(u8, scalar, "true")) return true;
    if (std.mem.eql(u8, scalar, "false")) return false;
    return error.InvalidBool;
}

fn parseOptionalBool(value: yaml.Yaml.Value) !?bool {
    if (value == .empty) return null;
    const scalar = try value.asScalar();
    if (std.mem.eql(u8, scalar, "null") or std.mem.eql(u8, scalar, "~")) return null;
    return try parseBool(value);
}

fn parseRoot(value: yaml.Yaml.Value) !Root {
    const scalar = try value.asScalar();
    if (scalar.len != 66) return error.InvalidRoot;
    return hex.hexToRoot(scalar[0..66]);
}

fn parseOptionalRoot(value: yaml.Yaml.Value) !?Root {
    if (value == .empty) return null;
    const scalar = try value.asScalar();
    if (std.mem.eql(u8, scalar, "null") or std.mem.eql(u8, scalar, "~")) return null;
    return try parseRoot(value);
}

fn parseCheckpoint(value: yaml.Yaml.Value) !Checkpoint {
    const map = try value.asMap();
    return .{
        .epoch = try parseU64(map.get("epoch") orelse return error.InvalidCheck),
        .root = try parseRoot(map.get("root") orelse return error.InvalidCheck),
    };
}
