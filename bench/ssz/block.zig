const std = @import("std");
// TODO make this fork-agnostic
const BeaconBlock = @import("consensus_types").fulu.SignedBeaconBlock;
const ssz = @import("ssz");
const zbench = @import("zbench");
const download_era_options = @import("download_era_options");
const era = @import("era");
const config = @import("config");

// printf "Date: %s\nKernel: %s\nCPU: %s\nCPUs: %s\nMemory: %s\n" "$(date)" "$(uname -r)" "$(lscpu | grep 'Model name' | awk -F: '{print $2}' | xargs)" "$(lscpu | grep '^CPU(s):' | awk '{print $2}')" "$(free -h | grep Mem | awk '{print $2}')"
// Date: Wed Oct 14 14:53:18 UTC 2026
// Kernel: 6.8.0-137-generic
// CPU: Intel(R) Xeon(R) E-2386G CPU @ 3.50GHz
// CPUs: 12
// Memory: 31Gi
// zig build run:bench_ssz_block -Doptimize=ReleaseSafe -Dcpu=baseline
//
// benchmark                           runs     total time     time/run (avg ± σ)    (min ... max)                p75        p99        p995
// ------------------------------------------------------------------------------------------------------------------------------------------------
// serialize block                     100000   1.627s         16.272us ± 198.952us  (11.947us ... 50.707ms)      14.226us   29.014us   78.79us
// serialize block prealloc            100000   109.593ms      1.095us ± 287ns       (953ns ... 51.879us)         1.074us    1.727us    1.806us
// deserialize block                   6784     2.109s         310.918us ± 147.745us (235.231us ... 2.434ms)      293.867us  998.163us  1.138ms
// deserialize block prealloc struct   6633     1.847s         278.491us ± 126.822us (230.904us ... 1.551ms)      258.696us  991.484us  1.071ms
// validate block                      100000   9.515ms        95ns ± 45ns           (87ns ... 9.919us)           95ns       141ns      186ns
// hash block                          2857     1.984s         694.535us ± 162.223us (585.367us ... 2.015ms)      675.051us  1.319ms    1.399ms
// hash block prealloc                 10408    2.008s         192.964us ± 29.689us  (181.182us ... 2.505ms)      194.119us  237.014us  242.008us
// hash block oneshot                  10368    1.984s         191.449us ± 6.645us   (183.301us ... 343.386us)    191.683us  222.552us  230.138us
// hash block serialized               10098    1.94s          192.137us ± 6.475us   (183.38us ... 255.293us)     192.805us  220.385us  231.164us

const SerializeBlock = struct {
    block: *BeaconBlock.Type,
    pub fn run(self: *SerializeBlock, allocator: std.mem.Allocator) void {
        const out = allocator.alloc(u8, BeaconBlock.serializedSize(self.block)) catch unreachable;
        _ = BeaconBlock.serializeIntoBytes(self.block, out);
    }
};

const SerializeBlockNoAlloc = struct {
    block: *BeaconBlock.Type,
    out: []u8,
    pub fn run(self: *SerializeBlockNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        _ = BeaconBlock.serializeIntoBytes(self.block, self.out);
    }
};

const DeserializeBlock = struct {
    bytes: []const u8,
    pub fn run(self: *DeserializeBlock, allocator: std.mem.Allocator) void {
        const out = allocator.create(BeaconBlock.Type) catch unreachable;
        defer allocator.destroy(out);
        out.* = BeaconBlock.default_value;
        defer BeaconBlock.deinit(allocator, out);
        BeaconBlock.deserializeFromBytes(allocator, self.bytes, out) catch unreachable;
    }
};

// Only the outer struct is preallocated; each run allocates and releases its decoded fields.
const DeserializeBlockPreallocatedStruct = struct {
    bytes: []const u8,
    out: *BeaconBlock.Type,
    pub fn run(self: *DeserializeBlockPreallocatedStruct, allocator: std.mem.Allocator) void {
        self.out.* = BeaconBlock.default_value;
        defer BeaconBlock.deinit(allocator, self.out);
        BeaconBlock.deserializeFromBytes(allocator, self.bytes, self.out) catch unreachable;
    }
};

const ValidateBlock = struct {
    bytes: []const u8,
    pub fn run(self: *ValidateBlock, allocator: std.mem.Allocator) void {
        _ = allocator;
        BeaconBlock.serialized.validate(self.bytes) catch unreachable;
    }
};

const HashBlock = struct {
    block: *BeaconBlock.Type,
    pub fn run(self: *HashBlock, allocator: std.mem.Allocator) void {
        var scratch = ssz.Hasher(BeaconBlock).init(allocator) catch unreachable;
        defer scratch.deinit(allocator);

        var out: [32]u8 = undefined;
        ssz.Hasher(BeaconBlock).hash(&scratch, self.block, &out) catch unreachable;
    }
};

const HashBlockNoAlloc = struct {
    block: *BeaconBlock.Type,
    scratch: *ssz.HasherData,
    pub fn run(self: *HashBlockNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        var out: [32]u8 = undefined;
        ssz.Hasher(BeaconBlock).hash(self.scratch, self.block, &out) catch unreachable;
    }
};

const HashBlockOneshot = struct {
    block: *BeaconBlock.Type,
    pub fn run(self: *HashBlockOneshot, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        BeaconBlock.hashTreeRoot(allocator, self.block, &out) catch unreachable;
    }
};

const HashBlockSerialized = struct {
    bytes: []const u8,
    pub fn run(self: *HashBlockSerialized, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        BeaconBlock.serialized.hashTreeRoot(allocator, self.bytes, &out) catch unreachable;
    }
};

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.page_allocator;
    const io = init.io;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    const era_path = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[1] },
    );
    defer allocator.free(era_path);

    var era_reader = try era.Reader.open(allocator, io, config.mainnet.config, era_path);
    defer era_reader.close(allocator);

    const block_slot = try era.era.computeStartBlockSlotFromEraNumber(era_reader.era_number) + 1;

    const block_bytes: []u8 = @constCast(try era_reader.readSerializedBlock(allocator, block_slot) orelse return error.InvalidEraFile);
    defer allocator.free(block_bytes);

    const block = allocator.create(BeaconBlock.Type) catch unreachable;
    defer allocator.destroy(block);
    block.* = BeaconBlock.default_value;
    defer BeaconBlock.deinit(allocator, block);
    BeaconBlock.deserializeFromBytes(allocator, block_bytes, block) catch unreachable;

    const serialize_block = SerializeBlock{ .block = block };
    try bench.addParam("serialize block", &serialize_block, .{});

    const serialize_block_no_alloc = SerializeBlockNoAlloc{ .block = block, .out = block_bytes };
    try bench.addParam("serialize block prealloc", &serialize_block_no_alloc, .{});

    const deserialize_block = DeserializeBlock{ .bytes = block_bytes };
    try bench.addParam("deserialize block", &deserialize_block, .{});

    const decoded = try allocator.create(BeaconBlock.Type);
    defer allocator.destroy(decoded);

    const deserialize_block_preallocated = DeserializeBlockPreallocatedStruct{ .bytes = block_bytes, .out = decoded };
    try bench.addParam("deserialize block prealloc struct", &deserialize_block_preallocated, .{});

    const validate_block = ValidateBlock{ .bytes = block_bytes };
    try bench.addParam("validate block", &validate_block, .{});

    const hash_block = HashBlock{ .block = block };
    try bench.addParam("hash block", &hash_block, .{});

    var scratch = ssz.Hasher(BeaconBlock).init(allocator) catch unreachable;
    defer scratch.deinit(allocator);

    var root: [32]u8 = undefined;
    ssz.Hasher(BeaconBlock).hash(&scratch, block, &root) catch unreachable;

    const hash_block_no_alloc = HashBlockNoAlloc{ .block = block, .scratch = &scratch };
    try bench.addParam("hash block prealloc", &hash_block_no_alloc, .{});

    const hash_block_oneshot = HashBlockOneshot{ .block = block };
    try bench.addParam("hash block oneshot", &hash_block_oneshot, .{});

    const hash_block_serialized = HashBlockSerialized{ .bytes = block_bytes };
    try bench.addParam("hash block serialized", &hash_block_serialized, .{});

    try bench.run(io, std.Io.File.stdout());
}
