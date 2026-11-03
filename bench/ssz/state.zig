const std = @import("std");
// TODO make this fork-agnostic
const BeaconState = @import("consensus_types").fulu.BeaconState;
const ssz = @import("ssz");
const zbench = @import("zbench");
const download_era_options = @import("download_era_options");
const era = @import("era");
const config = @import("config");

// printf "Date: %s\nKernel: %s\nCPU: %s\nCPUs: %s\nMemory: %s\n" "$(date)" "$(uname -r)" "$(lscpu | grep 'Model name' | awk -F: '{print $2}' | xargs)" "$(lscpu | grep '^CPU(s):' | awk '{print $2}')" "$(free -h | grep Mem | awk '{print $2}')"
// Date: Wed Oct 14 14:53:46 UTC 2026
// Kernel: 6.8.0-137-generic
// CPU: Intel(R) Xeon(R) E-2386G CPU @ 3.50GHz
// CPUs: 12
// Memory: 31Gi
// zig build run:bench_ssz_state -Doptimize=ReleaseSafe -Dcpu=baseline
//
// benchmark                           runs     total time     time/run (avg ± σ)    (min ... max)                p75        p99        p995
// ------------------------------------------------------------------------------------------------------------------------------------------------
// serialize state                     13       1.966s         151.27ms ± 33.964ms   (128.607ms ... 253.998ms)    148.617ms  253.998ms  253.998ms
// serialize state prealloc            59       2.065s         35.006ms ± 3.751ms    (32.225ms ... 46.972ms)      34.981ms   46.972ms   46.972ms
// deserialize state                   7        2.069s         295.608ms ± 35.334ms  (263.631ms ... 369.91ms)     300.33ms   369.91ms   369.91ms
// deserialize state prealloc struct   6        1.617s         269.55ms ± 4.865ms    (262.841ms ... 277.781ms)    271.049ms  277.781ms  277.781ms
// validate state                      160      2.064s         12.905ms ± 732.022us  (12.101ms ... 16.052ms)      12.97ms    15.821ms   16.052ms
// hash state                          1        1.48s          1.48s ± 0ns           (1.48s ... 1.48s)            1.48s      1.48s      1.48s
// hash state prealloc                 1        1.273s         1.273s ± 0ns          (1.273s ... 1.273s)          1.273s     1.273s     1.273s
// hash state oneshot                  1        1.129s         1.129s ± 0ns          (1.129s ... 1.129s)          1.129s     1.129s     1.129s
// hash state serialized               1        1.117s         1.117s ± 0ns          (1.117s ... 1.117s)          1.117s     1.117s     1.117s

const SerializeState = struct {
    state: *BeaconState.Type,
    pub fn run(self: *SerializeState, allocator: std.mem.Allocator) void {
        const out = allocator.alloc(u8, BeaconState.serializedSize(self.state)) catch unreachable;
        _ = BeaconState.serializeIntoBytes(self.state, out);
    }
};

const SerializeStateNoAlloc = struct {
    state: *BeaconState.Type,
    out: []u8,
    pub fn run(self: *SerializeStateNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        _ = BeaconState.serializeIntoBytes(self.state, self.out);
    }
};

const DeserializeState = struct {
    bytes: []const u8,
    pub fn run(self: *DeserializeState, allocator: std.mem.Allocator) void {
        const out = allocator.create(BeaconState.Type) catch unreachable;
        defer allocator.destroy(out);
        out.* = BeaconState.default_value;
        defer BeaconState.deinit(allocator, out);
        BeaconState.deserializeFromBytes(allocator, self.bytes, out) catch unreachable;
    }
};

// Only the outer struct is preallocated; each run allocates and releases its decoded fields.
const DeserializeStatePreallocatedStruct = struct {
    bytes: []const u8,
    out: *BeaconState.Type,
    pub fn run(self: *DeserializeStatePreallocatedStruct, allocator: std.mem.Allocator) void {
        self.out.* = BeaconState.default_value;
        defer BeaconState.deinit(allocator, self.out);
        BeaconState.deserializeFromBytes(allocator, self.bytes, self.out) catch unreachable;
    }
};

const ValidateState = struct {
    bytes: []const u8,
    pub fn run(self: *ValidateState, allocator: std.mem.Allocator) void {
        _ = allocator;
        BeaconState.serialized.validate(self.bytes) catch unreachable;
    }
};

const HashState = struct {
    state: *BeaconState.Type,
    pub fn run(self: *HashState, allocator: std.mem.Allocator) void {
        var scratch = ssz.Hasher(BeaconState).init(allocator) catch unreachable;
        defer scratch.deinit(allocator);

        var out: [32]u8 = undefined;
        ssz.Hasher(BeaconState).hash(&scratch, self.state, &out) catch unreachable;
    }
};

const HashStateNoAlloc = struct {
    state: *BeaconState.Type,
    scratch: *ssz.HasherData,
    pub fn run(self: *HashStateNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        var out: [32]u8 = undefined;
        ssz.Hasher(BeaconState).hash(self.scratch, self.state, &out) catch unreachable;
    }
};

const HashStateOneshot = struct {
    state: *BeaconState.Type,
    pub fn run(self: *HashStateOneshot, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        BeaconState.hashTreeRoot(allocator, self.state, &out) catch unreachable;
    }
};

const HashStateSerialized = struct {
    bytes: []const u8,
    pub fn run(self: *HashStateSerialized, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        BeaconState.serialized.hashTreeRoot(allocator, self.bytes, &out) catch unreachable;
    }
};

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.page_allocator;
    const io = init.io;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    const era_path = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[0] },
    );
    defer allocator.free(era_path);
    var era_reader = try era.Reader.open(allocator, io, config.mainnet.config, era_path);
    defer era_reader.close(allocator);

    const state_bytes: []u8 = @constCast(try era_reader.readSerializedState(allocator, null));
    defer allocator.free(state_bytes);

    const state = allocator.create(BeaconState.Type) catch unreachable;
    defer allocator.destroy(state);
    state.* = BeaconState.default_value;
    defer BeaconState.deinit(allocator, state);
    BeaconState.deserializeFromBytes(allocator, state_bytes, state) catch unreachable;

    const serialize_state = SerializeState{ .state = state };
    try bench.addParam("serialize state", &serialize_state, .{});

    const serialize_state_no_alloc = SerializeStateNoAlloc{ .state = state, .out = state_bytes };
    try bench.addParam("serialize state prealloc", &serialize_state_no_alloc, .{});

    const deserialize_state = DeserializeState{ .bytes = state_bytes };
    try bench.addParam("deserialize state", &deserialize_state, .{});

    const decoded = try allocator.create(BeaconState.Type);
    defer allocator.destroy(decoded);

    const deserialize_state_preallocated = DeserializeStatePreallocatedStruct{ .bytes = state_bytes, .out = decoded };
    try bench.addParam("deserialize state prealloc struct", &deserialize_state_preallocated, .{});

    const validate_state = ValidateState{ .bytes = state_bytes };
    try bench.addParam("validate state", &validate_state, .{});

    const hash_state = HashState{ .state = state };
    try bench.addParam("hash state", &hash_state, .{});

    var scratch = ssz.Hasher(BeaconState).init(allocator) catch unreachable;
    defer scratch.deinit(allocator);

    var root: [32]u8 = undefined;
    ssz.Hasher(BeaconState).hash(&scratch, state, &root) catch unreachable;

    const hash_state_no_alloc = HashStateNoAlloc{ .state = state, .scratch = &scratch };
    try bench.addParam("hash state prealloc", &hash_state_no_alloc, .{});

    const hash_state_oneshot = HashStateOneshot{ .state = state };
    try bench.addParam("hash state oneshot", &hash_state_oneshot, .{});

    const hash_state_serialized = HashStateSerialized{ .bytes = state_bytes };
    try bench.addParam("hash state serialized", &hash_state_serialized, .{});

    try bench.run(io, std.Io.File.stdout());
}
