const std = @import("std");
// TODO make this fork-agnostic
const BeaconState = @import("consensus_types").fulu.BeaconState;
const ssz = @import("ssz");
const zbench = @import("zbench");
const download_era_options = @import("download_era_options");
const era = @import("era");
const config = @import("config");

// printf "Date: %s\nKernel: %s\nCPU: %s\nCPUs: %s\nMemory: %s\n" "$(date)" "$(uname -r)" "$(lscpu | grep 'Model name' | awk -F: '{print $2}' | xargs)" "$(lscpu | grep '^CPU(s):' | awk '{print $2}')" "$(free -h | grep Mem | awk '{print $2}')"
// Date: Mon Apr 21 12:59:32 PM EDT 2025
// Kernel: 5.15.0-133-generic
// CPU: AMD Ryzen Threadripper 1950X 16-Core Processor
// CPUs: 32
// Memory: 62Gi

// zbuild run bench_state -Doptimize=ReleaseFast
//
// benchmark              runs     total time     time/run (avg ± σ)     (min ... max)                p75        p99        p995
// -----------------------------------------------------------------------------------------------------------------------------
// serialize state        14       1.898s         135.592ms ± 3.365ms    (133.059ms ... 145.075ms)    136.637ms  145.075ms  145.075ms
// serialize state preall 59       1.984s         33.627ms ± 1.412ms     (32.111ms ... 39.15ms)       33.97ms    39.15ms    39.15ms
// deserialize state      12       2.542s         211.847ms ± 51.699ms   (171.633ms ... 344.908ms)    219.912ms  344.908ms  344.908ms
// deserialize state prea 24       1.711s         71.321ms ± 7.46ms      (66.76ms ... 97.903ms)       70.22ms    97.903ms   97.903ms
// validate state         100000   2.39ms         23ns ± 16ns            (20ns ... 3.757us)           30ns       31ns       31ns
// hash state             2        1.903s         951.658ms ± 1.306ms    (950.734ms ... 952.582ms)    952.582ms  952.582ms  952.582ms
// hash state prealloc    2        1.85s          925.309ms ± 4.776ms    (921.932ms ... 928.687ms)    928.687ms  928.687ms  928.687ms
// hash state oneshot     2        1.856s         928.067ms ± 523.611us  (927.697ms ... 928.437ms)    928.437ms  928.437ms  928.437ms
// hash state serialized  2        1.844s         922.405ms ± 4.557ms    (919.183ms ... 925.628ms)    925.628ms  925.628ms  925.628ms

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
