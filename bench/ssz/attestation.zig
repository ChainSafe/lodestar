const std = @import("std");
// TODO make this fork-agnostic
const Attestation = @import("consensus_types").fulu.Attestation;
const SignedBeaconBlock = @import("consensus_types").fulu.SignedBeaconBlock;
const ssz = @import("ssz");
const zbench = @import("zbench");
const download_era_options = @import("download_era_options");
const era = @import("era");
const config = @import("config");

// printf "Date: %s\nKernel: %s\nCPU: %s\nCPUs: %s\nMemory: %s\n" "$(date)" "$(uname -r)" "$(lscpu | grep 'Model name' | awk -F: '{print $2}' | xargs)" "$(lscpu | grep '^CPU(s):' | awk '{print $2}')" "$(free -h | grep Mem | awk '{print $2}')"
// Date: Wed Oct 14 14:53:05 UTC 2026
// Kernel: 6.8.0-137-generic
// CPU: Intel(R) Xeon(R) E-2386G CPU @ 3.50GHz
// CPUs: 12
// Memory: 31Gi
// zig build run:bench_ssz_attestation -Doptimize=ReleaseSafe -Dcpu=baseline
//
// benchmark                                 runs     total time     time/run (avg ± σ)    (min ... max)                p75        p99        p995
// ------------------------------------------------------------------------------------------------------------------------------------------------------
// serialize attestation                     100000   195.054ms      1.95us ± 1.105us      (1.702us ... 59.264us)       1.848us    3.018us    4.25us
// serialize attestation prealloc            100000   10.816ms       108ns ± 38ns          (92ns ... 6.285us)           115ns      136ns      145ns
// deserialize attestation                   100000   1.224s         12.246us ± 20.638us   (7.7us ... 935.497us)        14us       29.246us   49.794us
// deserialize attestation prealloc struct   100000   638.142ms      6.381us ± 10.182us    (5.173us ... 605.338us)      5.961us    10.846us   13.107us
// validate attestation                      100000   1.799ms        17ns ± 45ns           (15ns ... 8.757us)           18ns       28ns       30ns
// hash attestation                          32598    1.836s         56.346us ± 57.708us   (42.592us ... 4.395ms)       51.712us   264.23us   458.083us
// hash attestation prealloc                 100000   784.329ms      7.843us ± 1.3us       (7.146us ... 52.211us)       7.674us    12.253us   16.632us
// hash attestation oneshot                  100000   767.966ms      7.679us ± 1.102us     (7.077us ... 71.305us)       7.524us    11.953us   14.48us
// hash attestation serialized               100000   761.216ms      7.612us ± 1.022us     (7.064us ... 68.106us)       7.462us    11.42us    13.807us
// equals attestation                        100000   1.791ms        17ns ± 14ns           (17ns ... 3.876us)           18ns       22ns       25ns

const SerializeAttestation = struct {
    attestation: *Attestation.Type,
    pub fn run(self: *SerializeAttestation, allocator: std.mem.Allocator) void {
        const out = allocator.alloc(u8, Attestation.serializedSize(self.attestation)) catch unreachable;
        _ = Attestation.serializeIntoBytes(self.attestation, out);
    }
};

const SerializeAttestationNoAlloc = struct {
    attestation: *Attestation.Type,
    out: []u8,
    pub fn run(self: *SerializeAttestationNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        _ = Attestation.serializeIntoBytes(self.attestation, self.out);
    }
};

const DeserializeAttestation = struct {
    bytes: []const u8,
    pub fn run(self: *DeserializeAttestation, allocator: std.mem.Allocator) void {
        const out = allocator.create(Attestation.Type) catch unreachable;
        defer allocator.destroy(out);
        out.* = Attestation.default_value;
        defer Attestation.deinit(allocator, out);
        Attestation.deserializeFromBytes(allocator, self.bytes, out) catch unreachable;
    }
};

// Only the outer struct is preallocated; each run allocates and releases its decoded fields.
const DeserializeAttestationPreallocatedStruct = struct {
    bytes: []const u8,
    out: *Attestation.Type,
    pub fn run(self: *DeserializeAttestationPreallocatedStruct, allocator: std.mem.Allocator) void {
        self.out.* = Attestation.default_value;
        defer Attestation.deinit(allocator, self.out);
        Attestation.deserializeFromBytes(allocator, self.bytes, self.out) catch unreachable;
    }
};

const ValidateAttestation = struct {
    bytes: []const u8,
    pub fn run(self: *ValidateAttestation, allocator: std.mem.Allocator) void {
        _ = allocator;
        Attestation.serialized.validate(self.bytes) catch unreachable;
    }
};

const HashAttestation = struct {
    attestation: *Attestation.Type,
    pub fn run(self: *HashAttestation, allocator: std.mem.Allocator) void {
        var scratch = ssz.Hasher(Attestation).init(allocator) catch unreachable;
        defer scratch.deinit(allocator);

        var out: [32]u8 = undefined;
        ssz.Hasher(Attestation).hash(&scratch, self.attestation, &out) catch unreachable;
    }
};

const HashAttestationNoAlloc = struct {
    attestation: *Attestation.Type,
    scratch: *ssz.HasherData,
    pub fn run(self: *HashAttestationNoAlloc, allocator: std.mem.Allocator) void {
        _ = allocator;
        var out: [32]u8 = undefined;
        ssz.Hasher(Attestation).hash(self.scratch, self.attestation, &out) catch unreachable;
    }
};

const HashAttestationOneshot = struct {
    attestation: *Attestation.Type,
    pub fn run(self: *HashAttestationOneshot, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        Attestation.hashTreeRoot(allocator, self.attestation, &out) catch unreachable;
    }
};

const HashAttestationSerialized = struct {
    bytes: []const u8,
    pub fn run(self: *HashAttestationSerialized, allocator: std.mem.Allocator) void {
        var out: [32]u8 = undefined;
        Attestation.serialized.hashTreeRoot(allocator, self.bytes, &out) catch unreachable;
    }
};

const EqualsAttestation = struct {
    a: *Attestation.Type,
    b: *Attestation.Type,
    pub fn run(self: *EqualsAttestation, _: std.mem.Allocator) void {
        _ = Attestation.equals(self.a, self.b);
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

    const block = allocator.create(SignedBeaconBlock.Type) catch unreachable;
    defer allocator.destroy(block);
    block.* = SignedBeaconBlock.default_value;
    defer SignedBeaconBlock.deinit(allocator, block);
    try SignedBeaconBlock.deserializeFromBytes(allocator, block_bytes, block);

    const attestation = &block.message.body.attestations.items[0];
    const attestation_bytes = try allocator.alloc(u8, Attestation.serializedSize(attestation));
    defer allocator.free(attestation_bytes);
    _ = Attestation.serializeIntoBytes(attestation, attestation_bytes);

    const serialize_attestation = SerializeAttestation{ .attestation = attestation };
    try bench.addParam("serialize attestation", &serialize_attestation, .{});

    const serialize_attestation_no_alloc = SerializeAttestationNoAlloc{ .attestation = attestation, .out = attestation_bytes };
    try bench.addParam("serialize attestation prealloc", &serialize_attestation_no_alloc, .{});

    const deserialize_attestation = DeserializeAttestation{ .bytes = attestation_bytes };
    try bench.addParam("deserialize attestation", &deserialize_attestation, .{});

    const decoded = try allocator.create(Attestation.Type);
    defer allocator.destroy(decoded);

    const deserialize_attestation_preallocated = DeserializeAttestationPreallocatedStruct{ .bytes = attestation_bytes, .out = decoded };
    try bench.addParam("deserialize attestation prealloc struct", &deserialize_attestation_preallocated, .{});

    const validate_attestation = ValidateAttestation{ .bytes = attestation_bytes };
    try bench.addParam("validate attestation", &validate_attestation, .{});

    const hash_attestation = HashAttestation{ .attestation = attestation };
    try bench.addParam("hash attestation", &hash_attestation, .{});

    var scratch = ssz.Hasher(Attestation).init(allocator) catch unreachable;
    defer scratch.deinit(allocator);

    var root: [32]u8 = undefined;
    ssz.Hasher(Attestation).hash(&scratch, attestation, &root) catch unreachable;

    const hash_attestation_no_alloc = HashAttestationNoAlloc{ .attestation = attestation, .scratch = &scratch };
    try bench.addParam("hash attestation prealloc", &hash_attestation_no_alloc, .{});

    const hash_attestation_oneshot = HashAttestationOneshot{ .attestation = attestation };
    try bench.addParam("hash attestation oneshot", &hash_attestation_oneshot, .{});

    const hash_attestation_serialized = HashAttestationSerialized{ .bytes = attestation_bytes };
    try bench.addParam("hash attestation serialized", &hash_attestation_serialized, .{});

    const equals_attestation = EqualsAttestation{ .a = attestation, .b = attestation };
    try bench.addParam("equals attestation", &equals_attestation, .{});

    try bench.run(io, std.Io.File.stdout());
}
