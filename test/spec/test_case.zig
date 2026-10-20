const std = @import("std");
const Allocator = std.mem.Allocator;
const yaml = @import("yaml");
const snappy = @import("snappy").raw;
const ForkSeq = @import("config").ForkSeq;
const ChainConfig = @import("config").ChainConfig;
const active_preset = @import("preset").active_preset;
const isFixedType = @import("ssz").isFixedType;
const state_transition = @import("state_transition");
const Node = @import("persistent_merkle_tree").Node;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;

const types = @import("consensus_types");
const Epoch = types.primitive.Epoch.Type;
const phase0 = types.phase0;
const altair = types.altair;
const bellatrix = types.bellatrix;
const capella = types.capella;
const deneb = types.deneb;
const electra = types.electra;
const fulu = types.fulu;
const gloas = types.gloas;

pub const BlsSetting = enum {
    default,
    required,
    ignored,

    pub fn verify(self: BlsSetting) bool {
        return switch (self) {
            .required => true,
            .default, .ignored => false,
        };
    }
};

pub fn TestCaseUtils(comptime fork: ForkSeq) type {
    const ForkTypes = @field(types, fork.name());
    return struct {
        pub fn getForkPre() ForkSeq {
            return switch (fork) {
                .altair => .phase0,
                .bellatrix => .altair,
                .capella => .bellatrix,
                .deneb => .capella,
                .electra => .deneb,
                .fulu => .electra,
                .gloas => .fulu,
                else => unreachable,
            };
        }

        pub fn loadPreStatePreFork(allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir, fork_epoch: Epoch) !TestCachedBeaconState {
            const fork_pre = comptime getForkPre();
            const ForkPreTypes = @field(types, fork_pre.name());
            var pre_state = ForkPreTypes.BeaconState.default_value;
            try loadSszSnappyValue(ForkPreTypes.BeaconState, allocator, dir, "pre.ssz_snappy", &pre_state);
            defer ForkPreTypes.BeaconState.deinit(allocator, &pre_state);

            const pre_state_all_forks = try allocator.create(AnyBeaconState);
            errdefer allocator.destroy(pre_state_all_forks);

            pre_state_all_forks.* = @unionInit(
                AnyBeaconState,
                fork_pre.name(),
                try ForkPreTypes.BeaconState.TreeView.fromValue(allocator, pool, &pre_state),
            );
            errdefer pre_state_all_forks.deinit();

            var fixture_config = try loadSpecTestConfig(allocator, dir);
            defer fixture_config.deinit();
            return try TestCachedBeaconState.initFromStateWithConfig(allocator, pool, pre_state_all_forks, fork, fork_epoch, fixture_config.overrides);
        }

        pub fn loadPreState(allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir) !TestCachedBeaconState {
            var pre_state = ForkTypes.BeaconState.default_value;
            try loadSszSnappyValue(ForkTypes.BeaconState, allocator, dir, "pre.ssz_snappy", &pre_state);
            defer ForkTypes.BeaconState.deinit(allocator, &pre_state);

            const pre_state_all_forks = try allocator.create(AnyBeaconState);
            errdefer allocator.destroy(pre_state_all_forks);

            pre_state_all_forks.* = @unionInit(
                AnyBeaconState,
                fork.name(),
                try ForkTypes.BeaconState.TreeView.fromValue(allocator, pool, &pre_state),
            );
            errdefer pre_state_all_forks.deinit();

            var f = try pre_state_all_forks.fork();
            const fork_epoch = try f.get("epoch");
            var fixture_config = try loadSpecTestConfig(allocator, dir);
            defer fixture_config.deinit();
            return try TestCachedBeaconState.initFromStateWithConfig(allocator, pool, pre_state_all_forks, fork, fork_epoch, fixture_config.overrides);
        }

        /// consumer should deinit the returned state and destroy the pointer
        pub fn loadPostState(allocator: Allocator, pool: *Node.Pool, dir: std.Io.Dir) !?*AnyBeaconState {
            var post_state = ForkTypes.BeaconState.default_value;
            loadSszSnappyValue(ForkTypes.BeaconState, allocator, dir, "post.ssz_snappy", &post_state) catch |err| switch (err) {
                error.FileNotFound => return null,
                else => return err,
            };
            defer ForkTypes.BeaconState.deinit(allocator, &post_state);

            const post_state_all_forks = try allocator.create(AnyBeaconState);
            errdefer allocator.destroy(post_state_all_forks);

            post_state_all_forks.* = @unionInit(
                AnyBeaconState,
                fork.name(),
                try ForkTypes.BeaconState.TreeView.fromValue(allocator, pool, &post_state),
            );
            return post_state_all_forks;
        }
    };
}

const SpecTestConfig = struct {
    arena: std.heap.ArenaAllocator,
    overrides: ChainConfig.OptionalChainConfig,

    fn deinit(self: *SpecTestConfig) void {
        self.arena.deinit();
    }
};

fn loadSpecTestConfig(allocator: Allocator, dir: std.Io.Dir) !SpecTestConfig {
    const contents = dir.readFileAlloc(std.testing.io, "config.yaml", allocator, .limited(1024 * 1024)) catch |err| switch (err) {
        error.FileNotFound => return .{ .arena = .init(allocator), .overrides = .{} },
        else => return err,
    };
    defer allocator.free(contents);
    return parseSpecTestConfig(allocator, contents);
}

/// Parse scalars as text: converting 0x00000001 to a number would lose fork-version bytes.
/// Config files also contain networking fields absent from ChainConfig; only known fields
/// override native configuration, and malformed values of every known field are errors.
fn parseSpecTestConfig(allocator: Allocator, contents: []const u8) !SpecTestConfig {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const a = arena.allocator();
    var document = yaml.Yaml{ .source = contents };
    try document.load(a);
    if (document.docs.items.len != 1) return error.InvalidSpecConfig;
    const map = try document.docs.items[0].asMap();
    var overrides: ChainConfig.OptionalChainConfig = .{};
    inline for (std.meta.fields(ChainConfig)) |field| {
        if (map.get(field.name)) |value| {
            if (comptime std.mem.eql(u8, field.name, "BLOB_SCHEDULE")) {
                const entries = try value.asList();
                if (entries.len > 1024) return error.InvalidBlobSchedule;
                const schedule = try a.alloc(ChainConfig.BlobScheduleEntry, entries.len);
                for (entries, schedule) |entry, *out| {
                    const entry_map = try entry.asMap();
                    if (entry_map.count() != 2) return error.InvalidBlobSchedule;
                    const epoch = entry_map.get("EPOCH") orelse return error.InvalidBlobSchedule;
                    const max_blobs = entry_map.get("MAX_BLOBS_PER_BLOCK") orelse return error.InvalidBlobSchedule;
                    out.* = .{
                        .EPOCH = try std.fmt.parseInt(u64, try epoch.asScalar(), 0),
                        .MAX_BLOBS_PER_BLOCK = try std.fmt.parseInt(u64, try max_blobs.asScalar(), 0),
                    };
                }
                @field(overrides, field.name) = schedule;
            } else {
                const scalar = try value.asScalar();
                @field(overrides, field.name) = switch (@typeInfo(field.type)) {
                    .int => try std.fmt.parseInt(field.type, scalar, 0),
                    .array => |array| blk: {
                        comptime std.debug.assert(array.child == u8);
                        if (scalar.len != 2 + 2 * array.len or !std.mem.startsWith(u8, scalar, "0x")) return error.InvalidConfigBytes;
                        var bytes: field.type = undefined;
                        _ = try std.fmt.hexToBytes(&bytes, scalar[2..]);
                        break :blk bytes;
                    },
                    .@"enum" => blk: {
                        const preset = std.meta.stringToEnum(field.type, scalar) orelse return error.InvalidPreset;
                        if (preset != active_preset) return error.SpecPresetMismatch;
                        break :blk preset;
                    },
                    .pointer => scalar,
                    else => @compileError("Unsupported spec config field type: " ++ field.name),
                };
            }
        }
    }
    return .{ .arena = arena, .overrides = overrides };
}

/// execution.yaml describes the execution engine result independently of whether the
/// consensus operation is valid. An absent post-state must never force an invalid EL result.
pub fn loadExecutionPayloadStatus(allocator: Allocator, dir: std.Io.Dir) !state_transition.ExecutionPayloadStatus {
    const contents = try dir.readFileAlloc(std.testing.io, "execution.yaml", allocator, .limited(16 * 1024));
    defer allocator.free(contents);
    return parseExecutionPayloadStatus(allocator, contents);
}

fn parseExecutionPayloadStatus(allocator: Allocator, contents: []const u8) !state_transition.ExecutionPayloadStatus {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var document = yaml.Yaml{ .source = contents };
    try document.load(arena.allocator());
    if (document.docs.items.len != 1) return error.InvalidExecutionMetadata;
    const map = try document.docs.items[0].asMap();
    const value = map.get("execution_valid") orelse return error.InvalidExecutionMetadata;
    const scalar = try value.asScalar();
    if (std.mem.eql(u8, scalar, "true")) return .valid;
    if (std.mem.eql(u8, scalar, "false")) return .invalid;
    return error.InvalidExecutionMetadata;
}

test "spec metadata and negative fixtures reject malformed data and resource failures" {
    const allocator = std.testing.allocator;
    const fixture =
        "PRESET_BASE: '" ++ @tagName(active_preset) ++ "'\n" ++
        \\CONFIG_NAME: 'fixture-owned'
        \\GENESIS_FORK_VERSION: 0x00000001
        \\GLOAS_FORK_VERSION: '0x07000001'
        \\GLOAS_FORK_EPOCH: 18446744073709551615
        \\TERMINAL_TOTAL_DIFFICULTY: 115792089237316195423570985008687907853269984665640564039457584007913129639935
        \\MIN_BUILDER_WITHDRAWABILITY_DELAY: 2
        \\BLOB_SCHEDULE:
        \\  - EPOCH: 3
        \\    MAX_BLOBS_PER_BLOCK: 9
        \\  - EPOCH: 7
        \\    MAX_BLOBS_PER_BLOCK: 12
        \\IGNORED_NETWORK_FIELD: {future: true}
        ;
    var parsed = try parseSpecTestConfig(allocator, fixture);
    defer parsed.deinit();
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 1 }, &parsed.overrides.GENESIS_FORK_VERSION.?);
    try std.testing.expectEqualSlices(u8, &.{ 7, 0, 0, 1 }, &parsed.overrides.GLOAS_FORK_VERSION.?);
    try std.testing.expectEqual(std.math.maxInt(u64), parsed.overrides.GLOAS_FORK_EPOCH.?);
    try std.testing.expectEqual(std.math.maxInt(u256), parsed.overrides.TERMINAL_TOTAL_DIFFICULTY.?);
    try std.testing.expectEqualStrings("fixture-owned", parsed.overrides.CONFIG_NAME.?);
    try std.testing.expectEqual(@as(usize, 2), parsed.overrides.BLOB_SCHEDULE.?.len);
    try std.testing.expectEqual(@as(u64, 7), parsed.overrides.BLOB_SCHEDULE.?[1].EPOCH);
    try std.testing.expectEqual(@as(u64, 12), parsed.overrides.BLOB_SCHEDULE.?[1].MAX_BLOBS_PER_BLOCK);
    try std.testing.expectEqual(@as(?u64, null), parsed.overrides.ALTAIR_FORK_EPOCH);

    var empty_schedule = try parseSpecTestConfig(allocator, "BLOB_SCHEDULE: []\n");
    defer empty_schedule.deinit();
    try std.testing.expectEqual(@as(usize, 0), empty_schedule.overrides.BLOB_SCHEDULE.?.len);
    try std.testing.expectError(error.InvalidConfigBytes, parseSpecTestConfig(allocator, "GLOAS_FORK_VERSION: 0x1\n"));
    try std.testing.expectError(error.Overflow, parseSpecTestConfig(allocator, "GLOAS_FORK_EPOCH: 18446744073709551616\n"));
    try std.testing.expectError(error.TypeMismatch, parseSpecTestConfig(allocator, "MIN_BUILDER_WITHDRAWABILITY_DELAY: []\n"));
    try std.testing.expectError(error.InvalidBlobSchedule, parseSpecTestConfig(allocator, "BLOB_SCHEDULE: [{EPOCH: 1}]\n"));
    try std.testing.expectError(error.DuplicateMapKey, parseSpecTestConfig(allocator, "GLOAS_FORK_EPOCH: 1\nGLOAS_FORK_EPOCH: 2\n"));

    const other_preset = if (active_preset == .minimal) "mainnet" else "minimal";
    try std.testing.expectError(error.SpecPresetMismatch, parseSpecTestConfig(allocator, "PRESET_BASE: " ++ other_preset ++ "\n"));
    try std.testing.expectEqual(.valid, try parseExecutionPayloadStatus(allocator, "{execution_valid: true}\n"));
    try std.testing.expectEqual(.invalid, try parseExecutionPayloadStatus(allocator, "execution_valid: false\n"));
    try std.testing.expectError(error.InvalidExecutionMetadata, parseExecutionPayloadStatus(allocator, "{execution_valid: 1}\n"));
    try std.testing.expectError(error.InvalidExecutionMetadata, parseExecutionPayloadStatus(allocator, "{}\n"));
    try std.testing.expectEqual(.default, try parseBlsSetting(allocator, "{bls_setting: 0}\n"));
    try std.testing.expectEqual(.required, try parseBlsSetting(allocator, "{bls_setting: 1}\n"));
    try std.testing.expectEqual(.ignored, try parseBlsSetting(allocator, "bls_setting: 2\n"));
    try std.testing.expectEqual(.default, try parseBlsSetting(allocator, "{description: 'bls_setting: 1'}\n"));
    try std.testing.expectEqual(.default, try parseBlsSetting(allocator, "{} # bls_setting: 1\n"));
    try std.testing.expectError(error.InvalidBlsMetadata, parseBlsSetting(allocator, "{bls_setting: 10}\n"));
    try std.testing.expectError(error.InvalidBlsMetadata, parseBlsSetting(allocator, "{bls_setting: 01}\n"));
    try std.testing.expectError(error.TypeMismatch, parseBlsSetting(allocator, "{bls_setting: []}\n"));
    try std.testing.expectError(error.DuplicateMapKey, parseBlsSetting(allocator, "bls_setting: 1\nbls_setting: 2\n"));

    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var absent = try loadSpecTestConfig(allocator, temporary.dir);
    defer absent.deinit();
    try std.testing.expectEqual(@as(?u64, null), absent.overrides.GLOAS_FORK_EPOCH);
    try std.testing.expectError(error.FileNotFound, loadExecutionPayloadStatus(allocator, temporary.dir));
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = "execution.yaml", .data = "{execution_valid: true}\n" });
    try std.testing.expectEqual(.valid, try loadExecutionPayloadStatus(allocator, temporary.dir));
    try std.testing.expectEqual(.default, try loadBlsSetting(allocator, temporary.dir));
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = "meta.yaml", .data = "{bls_setting: 1}\n" });
    try std.testing.expectEqual(.required, try loadBlsSetting(allocator, temporary.dir));
    var failing_read = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, loadBlsSetting(failing_read.allocator(), temporary.dir));
    const oversized_metadata: [16 * 1024 + 1]u8 = @splat(' ');
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = "meta.yaml", .data = &oversized_metadata });
    try std.testing.expectError(error.StreamTooLong, loadBlsSetting(allocator, temporary.dir));

    const Failure = struct {
        fn parse(failing: Allocator, data: []const u8) !void {
            var config = try parseSpecTestConfig(failing, data);
            defer config.deinit();
        }

        fn parseBls(failing: Allocator, data: []const u8) !void {
            _ = try parseBlsSetting(failing, data);
        }
    };
    try std.testing.checkAllAllocationFailures(allocator, Failure.parse, .{fixture});
    try std.testing.checkAllAllocationFailures(allocator, Failure.parseBls, .{"{blocks_count: 2, bls_setting: 1}\n"});

    inline for (.{ error.OutOfMemory, error.PoolExhausted, error.RefCountOverflow, error.InvalidPoolCapacity, error.SystemResources, error.ThreadQuotaExceeded, error.ConcurrencyUnavailable, error.SkipZigTest }) |infrastructure_error| {
        try std.testing.expectError(infrastructure_error, expectConsensusInvalid(infrastructure_error));
    }
    try expectConsensusInvalid(error.InvalidSignature);
    try expectConsensusInvalid(error.IndexOutOfBounds);
    try expectConsensusInvalid(error.Overflow);
    const NegativeFixture = struct {
        fn run(failing: Allocator) !void {
            const bytes = failing.alloc(u8, 1) catch |err| return expectConsensusInvalid(err);
            defer failing.free(bytes);
            return error.ExpectedError;
        }
    };
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, NegativeFixture.run(failing.allocator()));
}

/// Negative consensus vectors must fail validation, not exhaust test infrastructure.
/// Arithmetic and index errors remain consensus failures when processing invalid inputs.
pub fn expectConsensusInvalid(err: anyerror) !void {
    switch (err) {
        error.SkipZigTest,
        error.OutOfMemory,
        error.PoolExhausted,
        error.RefCountOverflow,
        error.InvalidPoolCapacity,
        error.SystemResources,
        error.ThreadQuotaExceeded,
        error.ConcurrencyUnavailable,
        => return err,
        else => {},
    }
}

pub fn loadBlsSetting(allocator: Allocator, dir: std.Io.Dir) !BlsSetting {
    const contents = dir.readFileAlloc(std.testing.io, "meta.yaml", allocator, .limited(16 * 1024)) catch |err| switch (err) {
        error.FileNotFound => return .default,
        else => return err,
    };
    defer allocator.free(contents);
    return parseBlsSetting(allocator, contents);
}

fn parseBlsSetting(allocator: Allocator, contents: []const u8) !BlsSetting {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var document = yaml.Yaml{ .source = contents };
    try document.load(arena.allocator());
    if (document.docs.items.len != 1) return error.InvalidBlsMetadata;
    const map = try document.docs.items[0].asMap();
    const value = map.get("bls_setting") orelse return .default;
    const scalar = try value.asScalar();
    if (std.mem.eql(u8, scalar, "0")) return .default;
    if (std.mem.eql(u8, scalar, "1")) return .required;
    if (std.mem.eql(u8, scalar, "2")) return .ignored;
    return error.InvalidBlsMetadata;
}

/// load SignedBeaconBlock from file using runtime fork
/// consumer should deinit the returned block and destroy the pointer
pub fn loadSignedBeaconBlock(allocator: std.mem.Allocator, fork: ForkSeq, dir: std.Io.Dir, file_name: []const u8) !AnySignedBeaconBlock {
    return switch (fork) {
        .phase0 => blk: {
            const out = try allocator.create(phase0.SignedBeaconBlock.Type);
            out.* = phase0.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.phase0.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .phase0 = out,
            };
        },
        .altair => blk: {
            const out = try allocator.create(altair.SignedBeaconBlock.Type);
            out.* = altair.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.altair.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .altair = out,
            };
        },
        .bellatrix => blk: {
            const out = try allocator.create(bellatrix.SignedBeaconBlock.Type);
            out.* = bellatrix.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.bellatrix.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_bellatrix = out,
            };
        },
        .capella => blk: {
            const out = try allocator.create(capella.SignedBeaconBlock.Type);
            out.* = capella.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.capella.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_capella = out,
            };
        },
        .deneb => blk: {
            const out = try allocator.create(deneb.SignedBeaconBlock.Type);
            out.* = deneb.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.deneb.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_deneb = out,
            };
        },
        .electra => blk: {
            const out = try allocator.create(electra.SignedBeaconBlock.Type);
            out.* = electra.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.electra.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_electra = out,
            };
        },
        .fulu => blk: {
            const out = try allocator.create(fulu.SignedBeaconBlock.Type);
            out.* = fulu.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.fulu.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_fulu = out,
            };
        },
        .gloas => blk: {
            const out = try allocator.create(gloas.SignedBeaconBlock.Type);
            out.* = gloas.SignedBeaconBlock.default_value;
            try loadSszSnappyValue(types.gloas.SignedBeaconBlock, allocator, dir, file_name, out);
            break :blk AnySignedBeaconBlock{
                .full_gloas = out,
            };
        },
    };
}

/// TODO: move this to SignedBeaconBlock deinit method if this is useful there
pub fn deinitSignedBeaconBlock(signed_block: AnySignedBeaconBlock, allocator: std.mem.Allocator) void {
    switch (signed_block) {
        .phase0 => |b| {
            phase0.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .altair => |b| {
            altair.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_bellatrix => |b| {
            bellatrix.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .blinded_bellatrix => |b| {
            bellatrix.SignedBlindedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_capella => |b| {
            capella.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .blinded_capella => |b| {
            capella.SignedBlindedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_deneb => |b| {
            deneb.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .blinded_deneb => |b| {
            deneb.SignedBlindedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_electra => |b| {
            electra.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .blinded_electra => |b| {
            electra.SignedBlindedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_fulu => |b| {
            fulu.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .blinded_fulu => |b| {
            fulu.SignedBlindedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
        .full_gloas => |b| {
            gloas.SignedBeaconBlock.deinit(allocator, @constCast(b));
            allocator.destroy(b);
        },
    }
}

pub fn loadSszSnappyValue(comptime ST: type, allocator: std.mem.Allocator, dir: std.Io.Dir, file_name: []const u8, out: *ST.Type) !void {
    const io = std.testing.io;
    const value_bytes = try dir.readFileAlloc(io, file_name, allocator, .unlimited);
    defer allocator.free(value_bytes);

    const serialized_buf = try allocator.alloc(u8, try snappy.uncompressedLength(value_bytes));
    defer allocator.free(serialized_buf);
    const serialized_len = try snappy.uncompress(value_bytes, serialized_buf);
    const serialized = serialized_buf[0..serialized_len];

    if (comptime isFixedType(ST)) {
        try ST.deserializeFromBytes(serialized, out);
    } else {
        try ST.deserializeFromBytes(allocator, serialized, out);
    }
}

pub fn expectEqualBeaconStates(expected: *AnyBeaconState, actual: *AnyBeaconState) !void {
    if (expected.forkSeq() != actual.forkSeq()) return error.ForkMismatch;

    if (!std.mem.eql(
        u8,
        try expected.hashTreeRoot(),
        try actual.hashTreeRoot(),
    )) {
        const Debug = struct {
            fn printDiff(comptime StateST: type, comptime fork: ForkSeq, expected_state: *AnyBeaconState, actual_state: *AnyBeaconState) !void {
                const expected_view: *StateST.TreeView = expected_state.castToFork(fork).inner;
                const actual_view: *StateST.TreeView = actual_state.castToFork(fork).inner;

                inline for (StateST.fields) |field| {
                    const expected_field_root = try expected_view.getFieldRoot(field.name);
                    const actual_field_root = try actual_view.getFieldRoot(field.name);
                    if (!std.mem.eql(u8, expected_field_root, actual_field_root)) {
                        std.debug.print(
                            "field: {s}\n  expected_root: {x}\n  actual_root:   {x}\n",
                            .{
                                field.name,
                                expected_field_root,
                                actual_field_root,
                            },
                        );
                    }
                }
            }
        };

        switch (expected.forkSeq()) {
            .phase0 => try Debug.printDiff(types.phase0.BeaconState, .phase0, expected, actual),
            .altair => try Debug.printDiff(types.altair.BeaconState, .altair, expected, actual),
            .bellatrix => try Debug.printDiff(types.bellatrix.BeaconState, .bellatrix, expected, actual),
            .capella => try Debug.printDiff(types.capella.BeaconState, .capella, expected, actual),
            .deneb => try Debug.printDiff(types.deneb.BeaconState, .deneb, expected, actual),
            .electra => try Debug.printDiff(types.electra.BeaconState, .electra, expected, actual),
            .fulu => try Debug.printDiff(types.fulu.BeaconState, .fulu, expected, actual),
            .gloas => try Debug.printDiff(types.gloas.BeaconState, .gloas, expected, actual),
        }
        return error.NotEqual;
    }
}
