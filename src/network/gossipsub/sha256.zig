//! SHA-256 over `prefix ++ topic ++ payload`, the transcript shape of gossip message ids and
//! fingerprints. Where build.zig links `sha256_accelerated.zig`, the first hash detects whether
//! the CPU and the OS support that object's features and caches the answer; every hash then runs
//! either that object or std's Sha256 for the build target.

const std = @import("std");
const builtin = @import("builtin");
const Sha256 = std.crypto.hash.sha2.Sha256;
const gossip_sha256_options = @import("gossip_sha256_options");

pub const Backend = enum(u8) { zig_std, x86_sha_avx2, aarch64_sha2 };

const Accelerated = fn (
    prefix: [*]const u8,
    prefix_len: usize,
    topic: [*]const u8,
    topic_len: usize,
    payload: [*]const u8,
    payload_len: usize,
    out: *[32]u8,
) callconv(.c) void;

const linked: ?*const Accelerated = if (gossip_sha256_options.accelerated)
    @extern(*const Accelerated, .{ .name = "lodestar_z_gossip_sha256", .visibility = .hidden })
else
    null;

const accelerated_backend: Backend = switch (builtin.cpu.arch) {
    .x86_64 => .x86_sha_avx2,
    .aarch64 => .aarch64_sha2,
    else => .zig_std,
};

const Selection = enum(u8) { unselected, zig_std, accelerated };
var selection = std.atomic.Value(Selection).init(.unselected);

/// SHA-256 of `prefix ++ topic ++ payload`.
pub fn digest(prefix: []const u8, topic: []const u8, payload: []const u8) [32]u8 {
    return hash(linked, accelerate(), prefix, topic, payload);
}

/// The implementation `digest` runs in this process.
pub fn backend() Backend {
    return if (accelerate()) accelerated_backend else .zig_std;
}

/// Detects on first use. Racing first calls detect the same answer, so either store stands.
fn accelerate() bool {
    const cached = selection.load(.monotonic);
    if (cached != .unselected) return cached == .accelerated;
    const selected: Selection = if (linked != null and supported(Hardware{})) .accelerated else .zig_std;
    selection.store(selected, .monotonic);
    return selected == .accelerated;
}

fn hash(
    comptime accelerated: ?*const Accelerated,
    use_accelerated: bool,
    prefix: []const u8,
    topic: []const u8,
    payload: []const u8,
) [32]u8 {
    var out: [32]u8 = undefined;
    if (accelerated) |run| {
        if (use_accelerated) {
            run(prefix.ptr, prefix.len, topic.ptr, topic.len, payload.ptr, payload.len, &out);
            return out;
        }
    }
    var state = Sha256.init(.{});
    state.update(prefix);
    state.update(topic);
    state.update(payload);
    state.final(&out);
    return out;
}

fn supported(probe: anytype) bool {
    return switch (builtin.cpu.arch) {
        .x86_64 => x86ShaAvx2(probe),
        .aarch64 => aarch64Sha2(probe),
        else => false,
    };
}

const Cpuid = struct { eax: u32, ebx: u32, ecx: u32, edx: u32 };

/// CPUID leaf 1 ECX: SSE3, SSSE3, SSE4.1 and SSE4.2 (the chain Zig's AVX implies, with CRC32 part
/// of SSE4.2), then XSAVE, OSXSAVE and AVX.
const leaf1_ecx_required: u32 = 1 << 0 | 1 << 9 | 1 << 19 | 1 << 20 | 1 << 26 | 1 << 27 | 1 << 28;
const osxsave: u32 = 1 << 27;
/// CPUID leaf 7 subleaf 0 EBX: AVX2 and SHA.
const leaf7_ebx_required: u32 = 1 << 5 | 1 << 29;
/// XCR0: the OS saves the XMM and YMM registers.
const xcr0_xmm_ymm: u64 = 1 << 1 | 1 << 2;

/// Whether the CPU implements every feature `sha256_accelerated.zig` enables beyond baseline
/// x86-64 and the OS saves the registers they use. XGETBV faults without OSXSAVE, so it runs last.
fn x86ShaAvx2(probe: anytype) bool {
    if (probe.cpuid(0).eax < 7) return false;
    if (probe.cpuid(1).ecx & leaf1_ecx_required != leaf1_ecx_required) return false;
    if (probe.cpuid(7).ebx & leaf7_ebx_required != leaf7_ebx_required) return false;
    return probe.xgetbv() & xcr0_xmm_ymm == xcr0_xmm_ymm;
}

/// Linux AT_HWCAP: FP, ASIMD (NEON), SHA1 and SHA2, the instructions `sha2` enables.
const hwcap_required: usize = 1 << 0 | 1 << 1 | 1 << 5 | 1 << 6;

/// Whether the kernel reports the instructions `sha256_accelerated.zig` enables beyond the baseline
/// aarch64 CPU. A failed or unavailable query reports none.
fn aarch64Sha2(probe: anytype) bool {
    return switch (builtin.os.tag) {
        .linux => probe.hwcap() & hwcap_required == hwcap_required,
        .macos => probe.sysctlFlag("hw.optional.arm.FEAT_SHA1") and probe.sysctlFlag("hw.optional.arm.FEAT_SHA256"),
        else => false,
    };
}

const Hardware = struct {
    fn hwcap(_: Hardware) usize {
        // std.os.linux reads the auxiliary vector Zig's own startup code saves, which a program
        // started by libc, and a shared library such as the addon, never has.
        if (builtin.link_libc) return @intCast(std.c.getauxval(std.elf.AT_HWCAP));
        return std.os.linux.getauxval(std.elf.AT_HWCAP);
    }

    fn sysctlFlag(_: Hardware, name: [*:0]const u8) bool {
        var value: c_int = 0;
        var len: usize = @sizeOf(c_int);
        if (std.c.sysctlbyname(name, &value, &len, null, 0) != 0) return false;
        return len == @sizeOf(c_int) and value == 1;
    }

    fn cpuid(_: Hardware, leaf: u32) Cpuid {
        var eax: u32 = undefined;
        var ebx: u32 = undefined;
        var ecx: u32 = undefined;
        var edx: u32 = undefined;
        asm volatile ("cpuid"
            : [_] "={eax}" (eax),
              [_] "={ebx}" (ebx),
              [_] "={ecx}" (ecx),
              [_] "={edx}" (edx),
            : [_] "{eax}" (leaf),
              [_] "{ecx}" (@as(u32, 0)),
        );
        return .{ .eax = eax, .ebx = ebx, .ecx = ecx, .edx = edx };
    }

    fn xgetbv(_: Hardware) u64 {
        var eax: u32 = undefined;
        var edx: u32 = undefined;
        asm volatile ("xgetbv"
            : [_] "={eax}" (eax),
              [_] "={edx}" (edx),
            : [_] "{ecx}" (@as(u32, 0)),
        );
        return @as(u64, edx) << 32 | eax;
    }
};

const testing = std.testing;

/// CPUID and XCR0 values, recording which leaves and how many XGETBVs the detector asked for.
const FakeCpu = struct {
    max_leaf: u32 = 7,
    leaf1_ecx: u32 = leaf1_ecx_required,
    leaf7_ebx: u32 = leaf7_ebx_required,
    xcr0: u64 = 1 << 0 | xcr0_xmm_ymm,
    leaves: u32 = 0,
    xgetbv_calls: u32 = 0,

    fn cpuid(self: *FakeCpu, leaf: u32) Cpuid {
        self.leaves |= @as(u32, 1) << @intCast(leaf);
        if (leaf > self.max_leaf) return .{ .eax = 0, .ebx = 0, .ecx = 0, .edx = 0 };
        return switch (leaf) {
            0 => .{ .eax = self.max_leaf, .ebx = 0, .ecx = 0, .edx = 0 },
            1 => .{ .eax = 0, .ebx = 0, .ecx = self.leaf1_ecx, .edx = 0 },
            7 => .{ .eax = 0, .ebx = self.leaf7_ebx, .ecx = 0, .edx = 0 },
            else => unreachable,
        };
    }

    fn xgetbv(self: *FakeCpu) u64 {
        self.xgetbv_calls += 1;
        return self.xcr0;
    }
};

/// An AT_HWCAP value and sysctl answers, for the aarch64 detector.
const FakeArm = struct {
    hwcap_value: usize = hwcap_required,
    sha1: bool = true,
    sha256: bool = true,

    fn hwcap(self: FakeArm) usize {
        return self.hwcap_value;
    }

    fn sysctlFlag(self: FakeArm, name: [*:0]const u8) bool {
        const flag = std.mem.span(name);
        if (std.mem.eql(u8, flag, "hw.optional.arm.FEAT_SHA1")) return self.sha1;
        if (std.mem.eql(u8, flag, "hw.optional.arm.FEAT_SHA256")) return self.sha256;
        unreachable;
    }
};

/// The running CPU with SHA-256 hidden, as on a CPU that lacks it.
const WithoutSha = struct {
    fn cpuid(_: WithoutSha, leaf: u32) Cpuid {
        var registers = (Hardware{}).cpuid(leaf);
        if (leaf == 7) registers.ebx &= ~@as(u32, 1 << 29);
        return registers;
    }

    fn xgetbv(_: WithoutSha) u64 {
        return (Hardware{}).xgetbv();
    }

    fn hwcap(_: WithoutSha) usize {
        return (Hardware{}).hwcap() & ~@as(usize, 1 << 6);
    }

    fn sysctlFlag(_: WithoutSha, name: [*:0]const u8) bool {
        return !std.mem.eql(u8, std.mem.span(name), "hw.optional.arm.FEAT_SHA256") and (Hardware{}).sysctlFlag(name);
    }
};

var fake_accelerated_calls: u32 = 0;

fn fakeAccelerated(_: [*]const u8, _: usize, _: [*]const u8, _: usize, _: [*]const u8, _: usize, out: *[32]u8) callconv(.c) void {
    fake_accelerated_calls += 1;
    out.* = @splat(0);
}

fn hardwareAccelerates() bool {
    return linked != null and supported(Hardware{});
}

/// Hashes with both implementations and checks that they agree.
fn expectBackendsAgree(prefix: []const u8, topic: []const u8, payload: []const u8) ![32]u8 {
    const software = hash(null, false, prefix, topic, payload);
    try testing.expectEqual(software, hash(linked, true, prefix, topic, payload));
    return software;
}

test "gossip sha256 detector refuses each missing capability before XGETBV" {
    // Leaves queried, as a bit mask: 0 alone, 0 and 1, or 0, 1 and 7.
    const leaf0: u32 = 1 << 0;
    const leaf01: u32 = leaf0 | 1 << 1;
    const leaf017: u32 = leaf01 | 1 << 7;
    const Case = struct { name: []const u8, cpu: FakeCpu, supported: bool, leaves: u32, xgetbv_calls: u32 };
    const cases = [_]Case{
        .{ .name = "all features", .cpu = .{}, .supported = true, .leaves = leaf017, .xgetbv_calls = 1 },
        .{ .name = "leaf 7 unavailable", .cpu = .{ .max_leaf = 6 }, .supported = false, .leaves = leaf0, .xgetbv_calls = 0 },
        .{ .name = "no SSE3", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 0) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no SSSE3", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 9) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no SSE4.1", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 19) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no SSE4.2", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 20) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no XSAVE", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 26) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "OSXSAVE disabled", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~osxsave }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no AVX", .cpu = .{ .leaf1_ecx = leaf1_ecx_required & ~@as(u32, 1 << 28) }, .supported = false, .leaves = leaf01, .xgetbv_calls = 0 },
        .{ .name = "no AVX2", .cpu = .{ .leaf7_ebx = 1 << 29 }, .supported = false, .leaves = leaf017, .xgetbv_calls = 0 },
        .{ .name = "no SHA", .cpu = .{ .leaf7_ebx = 1 << 5 }, .supported = false, .leaves = leaf017, .xgetbv_calls = 0 },
        .{ .name = "no XMM state", .cpu = .{ .xcr0 = 1 << 0 | 1 << 2 }, .supported = false, .leaves = leaf017, .xgetbv_calls = 1 },
        .{ .name = "no YMM state", .cpu = .{ .xcr0 = 1 << 0 | 1 << 1 }, .supported = false, .leaves = leaf017, .xgetbv_calls = 1 },
    };
    const software = hash(null, false, "prefix", "topic", "payload");
    for (cases) |case| {
        errdefer std.debug.print("case: {s}\n", .{case.name});
        var cpu = case.cpu;
        const detected = x86ShaAvx2(&cpu);
        try testing.expectEqual(case.supported, detected);
        try testing.expectEqual(case.leaves, cpu.leaves);
        try testing.expectEqual(case.xgetbv_calls, cpu.xgetbv_calls);

        fake_accelerated_calls = 0;
        const hashed = hash(&fakeAccelerated, detected, "prefix", "topic", "payload");
        try testing.expectEqual(@as(u32, @intFromBool(case.supported)), fake_accelerated_calls);
        if (!case.supported) try testing.expectEqual(software, hashed);
    }
}

test "gossip sha256 aarch64 detector requires every reported instruction" {
    const Case = struct { name: []const u8, arm: FakeArm, supported: bool };
    const linux = [_]Case{
        .{ .name = "all features", .arm = .{}, .supported = true },
        .{ .name = "no AT_HWCAP", .arm = .{ .hwcap_value = 0 }, .supported = false },
        .{ .name = "no FP", .arm = .{ .hwcap_value = hwcap_required & ~@as(usize, 1 << 0) }, .supported = false },
        .{ .name = "no ASIMD", .arm = .{ .hwcap_value = hwcap_required & ~@as(usize, 1 << 1) }, .supported = false },
        .{ .name = "no SHA1", .arm = .{ .hwcap_value = hwcap_required & ~@as(usize, 1 << 5) }, .supported = false },
        .{ .name = "no SHA2", .arm = .{ .hwcap_value = hwcap_required & ~@as(usize, 1 << 6) }, .supported = false },
    };
    const macos = [_]Case{
        .{ .name = "all features", .arm = .{}, .supported = true },
        .{ .name = "no FEAT_SHA1", .arm = .{ .sha1 = false }, .supported = false },
        .{ .name = "no FEAT_SHA256", .arm = .{ .sha256 = false }, .supported = false },
    };
    const cases: []const Case = switch (builtin.os.tag) {
        .linux => &linux,
        .macos => &macos,
        else => &.{},
    };
    for (cases) |case| {
        errdefer std.debug.print("case: {s}\n", .{case.name});
        try testing.expectEqual(case.supported, aarch64Sha2(case.arm));
    }
}

test "gossip sha256 backends agree across padding boundaries, alignment and the payload bound" {
    if (!hardwareAccelerates()) return error.SkipZigTest;
    const constants = @import("constants.zig");
    const bound = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE);
    const bytes = try testing.allocator.alloc(u8, bound + 8);
    defer testing.allocator.free(bytes);
    for (bytes, 0..) |*byte, i| byte.* = @truncate(i *% 131 +% 7);

    _ = try expectBackendsAgree(&.{}, &.{}, &.{});
    for ([_]usize{ 0, 1, 55, 56, 63, 64, 65, 119, 120, 128 }) |total| {
        for ([_]usize{ 0, 1, 12 }) |prefix_len| {
            if (prefix_len > total) continue;
            const topic_len = @min(total - prefix_len, 49);
            for (0..8) |offset| {
                const prefix = bytes[offset..][0..prefix_len];
                const topic = bytes[offset + 64 ..][0..topic_len];
                const payload = bytes[offset + 128 ..][0 .. total - prefix_len - topic_len];
                _ = try expectBackendsAgree(prefix, topic, payload);
            }
        }
    }
    _ = try expectBackendsAgree(&.{ 1, 0, 0, 0 }, "/eth2/01020304/beacon_block/ssz_snappy", bytes[1..][0..constants.MAX_PAYLOAD_SIZE]);
    _ = try expectBackendsAgree(&.{38}, "/eth2/01020304/beacon_block/ssz_snappy", bytes[3..][0..bound]);
}

test "gossip sha256 backends reproduce the message id vectors and Snappy encodings" {
    const valid = @import("constants.zig").MESSAGE_DOMAIN_VALID_SNAPPY;
    const invalid = @import("constants.zig").MESSAGE_DOMAIN_INVALID_SNAPPY;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    const other = "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy";
    const Vector = struct { domain: [4]u8, topic: []const u8, payload: []const u8, id: *const [40]u8 };
    const phase0 = [_]Vector{
        .{ .domain = valid, .topic = topic, .payload = "hello", .id = "79d62a59d0e47597aeb73cb85ba034c3f67f90e8" },
        .{ .domain = invalid, .topic = topic, .payload = "hello", .id = "44c0a0d0ddc9808a27834e778f82623f9c897072" },
        .{ .domain = valid, .topic = topic, .payload = "", .id = "67abdd721024f0ff4e0b3f4c2fc13bc5bad42d0b" },
        .{ .domain = invalid, .topic = topic, .payload = &.{0xff}, .id = "a0960f8d63bfe4fce6c26ae9e33f8f2d2729239a" },
    };
    const altair = [_]Vector{
        .{ .domain = valid, .topic = topic, .payload = "hello", .id = "a9fe6ab574e2aac2f18a37d95a6250a6e0f5b583" },
        .{ .domain = invalid, .topic = topic, .payload = &.{0xff}, .id = "a28c11a9057a41e968c2c3eead4b4c9fdd39c0d0" },
        .{ .domain = valid, .topic = other, .payload = "hello", .id = "da00350732db6a43c1f625bf287c9a136f6dfc75" },
        .{ .domain = invalid, .topic = other, .payload = &.{0xff}, .id = "6e01bb6dbc25bf015fe1884bae6973aff4614ddf" },
    };
    const accelerates = hardwareAccelerates();
    for (phase0 ++ altair, 0..) |vector, i| {
        var prefix: [12]u8 = undefined;
        prefix[0..4].* = vector.domain;
        std.mem.writeInt(u64, prefix[4..12], vector.topic.len, .little);
        const is_phase0 = i < phase0.len;
        const prefix_used: []const u8 = if (is_phase0) prefix[0..4] else &prefix;
        const topic_used: []const u8 = if (is_phase0) "" else vector.topic;
        const software = hash(null, false, prefix_used, topic_used, vector.payload);
        try testing.expectEqualStrings(vector.id, &std.fmt.bytesToHex(software[0..20], .lower));
        if (accelerates) try testing.expectEqual(software, hash(linked, true, prefix_used, topic_used, vector.payload));
    }

    const admission = @import("admission.zig");
    const literal = [_]u8{ 5, 16, 'h', 'e', 'l', 'l', 'o' };
    const split = [_]u8{ 5, 4, 'h', 'e', 8, 'l', 'l', 'o' };
    var ids: [2][32]u8 = undefined;
    var fingerprints: [2][32]u8 = undefined;
    for ([_][]const u8{ &literal, &split }, 0..) |encoded, i| {
        var output: [5]u8 = undefined;
        const decoded = admission.decode(&.{ .topic = topic, .data = encoded }, &output, .{}).valid;
        try testing.expectEqualStrings("hello", decoded.bytes);
        var prefix: [12]u8 = undefined;
        prefix[0..4].* = valid;
        std.mem.writeInt(u64, prefix[4..12], topic.len, .little);
        ids[i] = hash(null, false, &prefix, topic, decoded.bytes);
        fingerprints[i] = hash(null, false, &.{topic.len}, topic, encoded);
        if (accelerates) {
            try testing.expectEqual(ids[i], try expectBackendsAgree(&prefix, topic, decoded.bytes));
            try testing.expectEqual(fingerprints[i], try expectBackendsAgree(&.{topic.len}, topic, encoded));
        }
    }
    try testing.expectEqual(ids[0], ids[1]);
    try testing.expect(!std.mem.eql(u8, &fingerprints[0], &fingerprints[1]));
}

test "gossip sha256 falls back on capable hardware when a feature is masked" {
    if (!hardwareAccelerates()) return error.SkipZigTest;
    try testing.expect(!supported(WithoutSha{}));
    fake_accelerated_calls = 0;
    const payload = "masked";
    try testing.expectEqual(hash(null, false, "", "", payload), hash(&fakeAccelerated, supported(WithoutSha{}), "", "", payload));
    try testing.expectEqual(@as(u32, 0), fake_accelerated_calls);
    try testing.expectEqual(hash(null, false, "", "", payload), hash(linked, true, "", "", payload));
}

test "gossip sha256 selects the backend a qualification run expects" {
    const expected = testing.environ.getPosix("LODESTAR_Z_EXPECT_GOSSIP_SHA256") orelse return error.SkipZigTest;
    try testing.expectEqualStrings(expected, @tagName(backend()));
}

test "gossip sha256 selects once across concurrent first use" {
    selection.store(.unselected, .monotonic);
    const Worker = struct {
        fn run(result: *[32]u8, chosen: *Backend) void {
            result.* = digest("prefix", "topic", "payload");
            chosen.* = backend();
        }
    };
    var results: [8][32]u8 = undefined;
    var chosen: [8]Backend = undefined;
    var threads: [8]std.Thread = undefined;
    for (&threads, &results, &chosen) |*thread, *result, *backend_chosen| {
        thread.* = try std.Thread.spawn(.{}, Worker.run, .{ result, backend_chosen });
    }
    for (threads) |thread| thread.join();
    const expected: Backend = if (hardwareAccelerates()) accelerated_backend else .zig_std;
    for (results, chosen) |result, backend_chosen| {
        try testing.expectEqual(hash(null, false, "prefix", "topic", "payload"), result);
        try testing.expectEqual(expected, backend_chosen);
    }
    try testing.expect(selection.load(.monotonic) != .unselected);
}
