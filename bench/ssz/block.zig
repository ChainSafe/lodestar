const std = @import("std");
// TODO make this fork-agnostic
const BeaconBlock = @import("consensus_types").fulu.SignedBeaconBlock;
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

// zbuild run bench_block -Doptimize=ReleaseFast
//
// benchmark              runs     total time     time/run (avg ± σ)     (min ... max)                p75        p99        p995
// -----------------------------------------------------------------------------------------------------------------------------
// serialize block        9738     1.967s         202.017us ± 13.616us   (174.444us ... 367.754us)    206.525us  259.678us  267.251us
// serialize block preall 100000   1.502s         15.021us ± 918ns       (13.957us ... 79.853us)      15.299us   18.035us   20.059us
// deserialize block      1589     1.971s         1.24ms ± 27.861us      (1.18ms ... 1.527ms)         1.259ms    1.301ms    1.324ms
// deserialize block prea 1645     1.987s         1.208ms ± 28.544us     (1.129ms ... 1.461ms)        1.227ms    1.267ms    1.294ms
// validate block         100000   3.552ms        35ns ± 12ns            (30ns ... 3.436us)           40ns       41ns       50ns
// hash block             1297     2.023s         1.56ms ± 37.705us      (1.459ms ... 1.77ms)         1.586ms    1.639ms    1.658ms
// hash block prealloc    1777     1.987s         1.118ms ± 28.154us     (1.062ms ... 1.292ms)        1.141ms    1.193ms    1.225ms
// hash block oneshot     563      2.13s          3.784ms ± 73.197us     (3.598ms ... 4.66ms)         3.824ms    3.958ms    4.034ms
// hash block serialized  563      2s             3.552ms ± 65.788us     (3.411ms ... 3.905ms)        3.593ms    3.721ms    3.762ms

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
