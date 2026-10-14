const std = @import("std");
// TODO make this fork-agnostic
const BeaconBlock = @import("consensus_types").fulu.SignedBeaconBlock;
const ssz = @import("ssz");
const zbench = @import("zbench");
const download_era_options = @import("download_era_options");
const era = @import("era");
const config = @import("config");

// printf "Date: %s\nKernel: %s\nCPU: %s\nCPUs: %s\nMemory: %s\n" "$(date)" "$(uname -r)" "$(lscpu | grep 'Model name' | awk -F: '{print $2}' | xargs)" "$(lscpu | grep '^CPU(s):' | awk '{print $2}')" "$(free -h | grep Mem | awk '{print $2}')"
// Date: Wed Oct 14 09:12:59 UTC 2026
// Kernel: 6.8.0-137-generic
// CPU: Intel(R) Xeon(R) E-2386G CPU @ 3.50GHz
// CPUs: 12
// Memory: 31Gi
// zig build run:bench_ssz_block -Doptimize=ReleaseSafe
//
// benchmark                           runs     total time     time/run (avg ± σ)    (min ... max)                p75        p99        p995
// ------------------------------------------------------------------------------------------------------------------------------------------------
// serialize block                     90931    2.626s         28.887us ± 61.109us   (11.927us ... 6.271ms)       28.211us   60.197us   146.799us
// serialize block prealloc            100000   140.041ms      1.4us ± 613ns         (868ns ... 23.95us)          1.483us    2.432us    6.741us
// deserialize block                   5459     1.939s         355.366us ± 161.05us  (234.266us ... 2.646ms)      372.177us  1.026ms    1.133ms
// deserialize block prealloc struct   7005     1.924s         274.782us ± 130.015us (217.301us ... 1.798ms)      255.555us  979.856us  1.104ms
// validate block                      100000   10.305ms       103ns ± 190ns         (93ns ... 16.154us)          100ns      149ns      171ns
// hash block                          2664     1.903s         714.394us ± 190.295us (587.001us ... 3.948ms)      696.743us  1.349ms    1.432ms
// hash block prealloc                 10519    2.044s         194.366us ± 23.398us  (181.156us ... 1.067ms)      193.334us  262.208us  302.29us
// hash block oneshot                  10449    1.986s         190.086us ± 7.032us   (182.205us ... 283.28us)     190.762us  219.545us  226.113us
// hash block serialized               10144    1.985s         195.745us ± 25.201us  (178.231us ... 873.5us)      197.068us  318.001us  391.933us

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
