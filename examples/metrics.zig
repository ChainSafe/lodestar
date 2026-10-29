//! Simple example to show collection of metrics using metrics.zig, with mainnet era files.
//!
//! Metrics are served on `port` on a separate thread, which is visualized through Prometheus,
//! while we continuously run the state transition function using data from 2 consecutive era files.
//! Run a Prometheus instance to see the data visually.
//!
//! To run this example, we first require era files: `zig build run:download_era_files`.
//!
//! Then, run `zig build run:metrics_stf`.
//!
//! Note: this example is mainly meant to test that our metrics is working; realistically we do not need
//! such an example. The bulk of this code should be moved to our beacon node implementation once it's ready.

const download_era_options = @import("download_era_options");
const era = @import("era");
const c = @import("config");
const std = @import("std");
const httpz = @import("httpz");
const state_transition = @import("state_transition");
const types = @import("consensus_types");

const CachedBeaconState = state_transition.CachedBeaconState;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const active_preset = @import("preset").active_preset;
const preset = @import("preset").preset;
const mainnet_chain_config = @import("config").mainnet.chain_config;
const minimal_chain_config = @import("config").minimal.chain_config;
const BeaconConfig = @import("config").BeaconConfig;
const ValidatorIndex = @import("consensus_types").primitive.ValidatorIndex.Type;
const chain_config = if (active_preset == .mainnet) mainnet_chain_config else minimal_chain_config;

const MetricsHandler = struct {
    allocator: std.mem.Allocator,
};

pub fn serveMetrics(
    allocator: std.mem.Allocator,
    port: u16,
) !void {
    var handler = MetricsHandler{
        .allocator = allocator,
    };
    const address = "0.0.0.0";
    var server = try httpz.Server(*MetricsHandler).init(
        allocator,
        .{ .port = port, .address = address, .thread_pool = .{ .count = 1 } },
        &handler,
    );
    defer {
        server.stop();
        server.deinit();
    }
    var router = try server.router(.{});
    router.get("/metrics", getMetrics, .{});

    std.log.info("Listening at {s}/{d}", .{ address, port });
    try server.listen(); // blocks
}

/// Endpoint to write all state transition metrics to the server.
fn getMetrics(_: *MetricsHandler, _: *httpz.Request, res: *httpz.Response) !void {
    res.content_type = .TEXT;
    const writer = res.writer();
    try state_transition.metrics.write(writer);
}

fn eraReader(allocator: std.mem.Allocator, io: std.Io, era_path: []const u8) !era.Reader {
    std.debug.print("Reading era file at {s}\n", .{era_path});
    return try era.Reader.open(allocator, io, c.mainnet.config, era_path);
}

pub fn main(init: std.process.Init) !void {
    var gpa: std.heap.DebugAllocator(.{}) = .{ .backing_allocator = std.heap.smp_allocator };
    const allocator = gpa.allocator();
    const io = init.io;

    _ = try std.Thread.spawn(.{}, serveMetrics, .{ allocator, 8008 });

    try state_transition.metrics.init(allocator, io, .{});
    defer state_transition.metrics.state_transition.deinit();

    const era_path_state = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[0] },
    );
    defer allocator.free(era_path_state);
    const era_path_blocks = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[1] },
    );
    defer allocator.free(era_path_blocks);

    var reader_state = try eraReader(allocator, io, era_path_state);
    defer reader_state.close(allocator);
    var reader_blocks = try eraReader(allocator, io, era_path_blocks);
    defer reader_blocks.close(allocator);

    std.debug.print("Reading state\n", .{});
    var state_ptr = try allocator.create(@import("fork_types").AnyBeaconState);
    errdefer allocator.destroy(state_ptr);
    state_ptr.* = try reader_state.readState(allocator, null);
    const blocks_index = reader_blocks.group_indices[0].blocks_index orelse return error.NoBlockIndex;
    const max_new_validators = try std.math.mul(
        usize,
        blocks_index.offsets.len,
        preset.MAX_DEPOSITS,
    );
    const pubkey_capacity = try std.math.add(
        usize,
        try state_ptr.validatorsCount(),
        max_new_validators,
    );
    var pubkey_cache = try state_transition.PubkeyCache.initCapacity(
        allocator,
        io,
        pubkey_capacity,
    );
    defer pubkey_cache.deinit();

    const config = try allocator.create(BeaconConfig);
    defer allocator.destroy(config);
    config.* = BeaconConfig.init(chain_config, (try state_ptr.genesisValidatorsRoot()).*);

    const immutable_data = state_transition.EpochCacheImmutableData{
        .config = config,
        .pubkey_cache = &pubkey_cache,
    };

    std.debug.print("Creating cached beacon state\n", .{});
    var cached_state = try CachedBeaconState.createCachedBeaconState(
        allocator,
        io,
        state_ptr,
        immutable_data,
        .{
            .skip_sync_committee_cache = state_ptr.forkSeq() == .phase0,
            .skip_sync_pubkeys = false,
        },
    );
    defer {
        cached_state.deinit();
        allocator.destroy(cached_state);
    }
    std.debug.print("Running state transition.\nYou may open up a local prometheus instance to check out metrics in action.\n", .{});
    for (blocks_index.start_slot + 1..blocks_index.start_slot + blocks_index.offsets.len) |slot| {
        const block = try reader_blocks.readBlock(allocator, slot) orelse continue;
        defer block.deinit(allocator);

        const block_num = switch (block.blockType()) {
            .full => (try block.beaconBlock().beaconBlockBody().executionPayload()).blockNumber(),
            .blinded => (try block.beaconBlock().beaconBlockBody().executionPayloadHeader()).blockNumber(),
        };
        std.debug.print("state slot = {}, block number = {}\n", .{ try cached_state.state.slot(), block_num });

        const next = try state_transition.stateTransition(
            allocator,
            io,
            cached_state,
            block,
            .{
                .verify_signatures = false,
                .verify_proposer = false,
                .verify_state_root = false,
            },
        );

        cached_state.deinit();
        allocator.destroy(cached_state);
        cached_state = next;
    }
}
