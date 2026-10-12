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
// Date: Fri Apr 25 10:07:24 AM EDT 2025
// Kernel: 5.15.0-133-generic
// CPU: AMD Ryzen Threadripper 1950X 16-Core Processor
// CPUs: 32
// Memory: 62Gi

// zbuild run bench_attestation -Doptimize=ReleaseFast
//
// benchmark              runs     total time     time/run (avg ± σ)     (min ... max)                p75        p99        p995
// -----------------------------------------------------------------------------------------------------------------------------
// serialize attestation  100000   267.558ms      2.675us ± 570ns        (2.314us ... 40.227us)       2.625us    4.418us    4.649us
// serialize attestation  100000   3.897ms        38ns ± 22ns            (30ns ... 7.053us)           40ns       50ns       50ns
// deserialize attestatio 100000   532.577ms      5.325us ± 845ns        (4.508us ... 44.375us)       5.3us      7.614us    8.366us
// deserialize attestatio 100000   4.378ms        43ns ± 23ns            (30ns ... 7.194us)           50ns       60ns       60ns
// validate attestation   100000   2.384ms        23ns ± 25ns            (20ns ... 8.075us)           30ns       31ns       31ns
// hash attestation       57120    2.017s         35.321us ± 3.204us     (30.479us ... 119.979us)     36.129us   45.648us   48.352us
// hash attestation preal 100000   115.875ms      1.158us ± 268ns        (1.132us ... 32.542us)       1.153us    1.163us    1.272us
// hash attestation onesh 100000   632.905ms      6.329us ± 427ns        (5.981us ... 59.494us)       6.442us    7.184us    7.675us
// hash attestation seria 100000   657.36ms       6.573us ± 614ns        (5.991us ... 84.341us)       6.783us    7.234us    7.976us

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
