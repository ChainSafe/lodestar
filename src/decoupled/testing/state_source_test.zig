const std = @import("std");
const testing = std.testing;
const StateSource = @import("StateSource.zig");
const FG = @import("../fg/FinalityGadget.zig");
const AttestationPool = @import("../fg/AttestationPool.zig");
const fg = @import("../fg/finality_types.zig");
const limits = @import("../limits.zig");

// The store and the state source composed the way Node composes them, without a Node.
const config: fg.Config = .{ .B_gen = @splat(0), .n = 4, .K_W = 2, .delta_t = 2 };
fn root(n: u32) fg.Root {
    var result: fg.Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}
fn rows(h: u32, T: u32, tau: bool, h_f: ?u32, T_f: ?u32) [3]fg.Attestation {
    var result: [3]fg.Attestation = undefined;
    for (&result, 0..) |*a, v| {
        a.* = .{
            .val_index = @intCast(v),
            .h = h,
            .T = root(T),
            .tau = tau,
            .h_f = h_f,
            .T_f = if (T_f) |T_value| root(T_value) else null,
        };
    }
    return result;
}
const Harness = struct {
    source: StateSource,
    store: FG,
    pool: AttestationPool,

    fn create(options: *const fg.Config) !*Harness {
        const self = try testing.allocator.create(Harness);
        errdefer testing.allocator.destroy(self);
        try self.source.init(options);
        self.store.init(&.{ .B_gen = options.B_gen });
        self.pool.init();
        return self;
    }

    fn block(id: u32, slot: u32, parent: u32, attestations: []const fg.Attestation) fg.Block {
        return .{ .root = root(id), .slot = slot, .parent = root(parent), .proposer = 0, .attestations = attestations };
    }

    /// Node.acceptBlock without ingress validation: admission, transition, pool, store.
    fn accept(self: *Harness, B: *const fg.Block) !bool {
        if (!self.store.canAccept(B)) return false;
        const summary = try self.source.transition(B, 0) orelse return false;
        try self.pool.checkCapacity(B.attestations);
        try testing.expect(try self.store.onBlock(B, &summary));
        self.pool.absorb(B.attestations);
        return true;
    }

    fn add(self: *Harness, id: u32, slot: u32, parent: u32, attestations: []const fg.Attestation) !void {
        const B = block(id, slot, parent, attestations);
        try testing.expect(try self.accept(&B));
    }

    fn state(self: *const Harness, id: u32) *const StateSource.ChainState {
        return self.source.state(&root(id)).?;
    }

    const Eligibility = struct {
        harness: *const Harness,
        H: u32,
        root: *const fg.Root,
        pub fn eligible(self: Eligibility, a: *const fg.Attestation) bool {
            return self.harness.source.validAttestation(self.root, a) and
                !self.harness.store.includedOnChain(self.H, a);
        }
    };

    fn propose(self: *const Harness, H: u32, out: *AttestationPool.List) !void {
        const H_root = root(H);
        try self.pool.select(Eligibility{ .harness = self, .H = self.store.find(&H_root).?, .root = &H_root }, out);
    }
};

test "state source rejects invalid configurations and starts from the genesis state" {
    const source = try testing.allocator.create(StateSource);
    defer testing.allocator.destroy(source);
    var bad = config;
    bad.K_W = 1;
    try testing.expectError(error.InvalidConfig, source.init(&bad));
    try source.init(&config);
    try testing.expectEqual(@as(u32, 1), source.roots.count);
    try testing.expectEqual(@as(u32, 1), source.state(&root(0)).?.h);
    try testing.expectEqual(@as(?u32, null), source.find(&root(1)));
    try testing.expect(source.state(&root(0)).?.summary().valid());
}

test "minimum and maximum validator sets use q distinct participants" {
    for ([_]u32{ 1, limits.max_validators }) |n| {
        var options = config;
        options.n = n;
        const harness = try Harness.create(&options);
        defer testing.allocator.destroy(harness);
        const q = options.quorum();
        var attestations: [limits.max_validators]fg.Attestation = undefined;
        for (attestations[0..q], 0..) |*a, v| {
            a.* = .{
                .val_index = if (v + 1 == q) n - 1 else @intCast(v),
                .h = 1,
                .T = root(0),
                .tau = false,
            };
        }
        try harness.add(1, 1, 0, attestations[0..q]);
        try testing.expectEqual(@as(u32, 2), harness.state(1).h);
        try testing.expectEqual(@as(u32, 2), harness.store.summaries[1].h);
        try testing.expectEqual(@as(u32, 1), harness.store.h_j);
    }
}

test "accepted chain states justify and finalize while the store retains every block" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    try harness.add(1, 1, 0, &rows(1, 0, false, null, null));
    try harness.add(2, 2, 1, &rows(2, 1, false, 1, 0));
    try harness.add(3, 3, 2, &rows(3, 2, false, 2, 1));
    try testing.expectEqual(root(1), harness.store.F.root);
    try testing.expectEqual(root(2), harness.store.J.root);
    try testing.expectEqual(@as(u32, 3), harness.store.h_j);
    try testing.expectEqual(@as(u32, 4), harness.store.h_max);
    try testing.expectEqual(@as(u32, 4), harness.store.T.count);
    try testing.expectEqual(@as(u32, 4), harness.source.roots.count);
    try testing.expectEqualDeep(harness.state(3).summary(), harness.store.summaries[3]);
    const outside = Harness.block(9, 4, 0, &.{});
    try testing.expect(!try harness.accept(&outside));
    try testing.expectEqual(@as(u32, 4), harness.source.roots.count);
}

test "frontier contests arise from real transitions on both branches" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    try harness.add(1, 1, 0, &rows(1, 0, false, null, null));
    try harness.add(2, 1, 0, &rows(1, 0, false, null, null));
    try harness.add(3, 2, 1, &rows(2, 1, false, null, null));
    try testing.expect(!harness.store.fgContest());
    try harness.add(4, 2, 2, &rows(2, 2, false, null, null));
    try testing.expectEqual(root(2), harness.store.J.root);
    try testing.expect(harness.store.fgContest());
    try harness.add(5, 4, 4, &rows(3, 4, true, null, null));
    try testing.expectEqual(@as(u32, 4), harness.store.h_max);
    try testing.expect(!harness.store.fgContest());
}

test "finalization waits for a viable descendant before accepting the same root" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    var parent: u32 = 0;
    for (1..6) |height| {
        const id: u32 = @intCast(100 + height);
        try harness.add(id, @intCast(2 * height), parent, &rows(@intCast(height), parent, true, null, null));
        parent = id;
    }
    try testing.expectEqual(@as(u32, 6), harness.store.h_max);
    try harness.add(1, 1, 0, &rows(1, 0, false, null, null));
    try harness.add(2, 2, 1, &rows(2, 1, false, 1, 0));
    try harness.add(3, 3, 2, &rows(3, 2, false, 2, 1));
    try testing.expectEqual(root(1), harness.state(3).F.root);
    try testing.expectEqual(root(0), harness.store.F.root);
    try harness.add(4, 4, 3, &rows(4, 3, false, null, null));
    try testing.expectEqual(root(1), harness.store.F.root);
}

test "proposal filtering excludes attestations carried by the whole parent chain" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    var b = a;
    b.tau = true;
    var future = a;
    future.h = 99;
    try testing.expect(try harness.pool.add(&a));
    try testing.expect(try harness.pool.add(&b));
    try testing.expect(try harness.pool.add(&future));
    var selected: AttestationPool.List = undefined;
    try harness.propose(0, &selected);
    try testing.expectEqual(@as(u32, 2), selected.count);
    try testing.expect(selected.buffer[0].eql(&a));
    try testing.expect(selected.buffer[1].eql(&b));
    const repeated = [_]fg.Attestation{ a, a };
    try harness.add(1, 1, 0, &repeated);
    try testing.expectEqual(@as(u32, 2), harness.store.T.buffer[1].attestations.count);
    try testing.expectEqual(@as(u32, 3), harness.pool.entries.count);
    try harness.add(2, 2, 1, &.{});
    try harness.propose(2, &selected);
    try testing.expectEqual(@as(u32, 1), selected.count);
    try testing.expect(selected.buffer[0].eql(&b));
    try harness.add(3, 1, 0, &.{});
    try harness.propose(3, &selected);
    try testing.expectEqual(@as(u32, 2), selected.count);
}

test "rejected transitions store nothing and the pool keeps its capacity" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    try harness.add(1, 1, 0, &rows(1, 0, false, null, null));
    const before = harness.source.roots.count;
    var B = Harness.block(2, 1, 1, &.{});
    try testing.expectEqual(@as(?fg.BlockSummary, null), try harness.source.transition(&B, 0));
    B.slot = 2;
    try testing.expectEqual(@as(?fg.BlockSummary, null), try harness.source.transition(&B, 1));
    const bad = rows(1, 0, false, null, null);
    B.attestations = &bad;
    try testing.expectEqual(@as(?fg.BlockSummary, null), try harness.source.transition(&B, 0));
    try testing.expectEqual(before, harness.source.roots.count);
    try testing.expectEqual(@as(?u32, null), harness.source.find(&root(2)));
    B.slot = limits.max_slots;
    B.attestations = &.{};
    try testing.expectError(error.SlotCapacity, harness.source.transition(&B, 0));
    try testing.expectEqual(before, harness.source.roots.count);
}

test "owned block lists cannot be changed by the caller after the transition" {
    const harness = try Harness.create(&config);
    defer testing.allocator.destroy(harness);
    var a = [_]fg.Attestation{.{ .val_index = 0, .h = 1, .T = root(0), .tau = false }};
    const B = Harness.block(1, 1, 0, &a);
    try testing.expect(try harness.accept(&B));
    a[0].val_index = 3;
    try testing.expect(harness.state(1).target_participation[0]);
    try testing.expect(!harness.state(1).target_participation[3]);
    try testing.expectEqual(@as(u32, 0), harness.store.T.buffer[1].attestations.buffer[0].val_index);
}
