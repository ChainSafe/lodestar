//! Tests for `store.zig`.

const std = @import("std");
const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;
const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;
const Epoch = primitives.Epoch.Type;
const Root = primitives.Root.Type;
const testing = std.testing;
const constants = @import("constants");
const ZERO_HASH = constants.ZERO_HASH;
const store_mod = @import("store.zig");
const Checkpoint = store_mod.Checkpoint;
const ForkChoiceStore = store_mod.ForkChoiceStore;
const JustifiedBalances = store_mod.JustifiedBalances;
const JustifiedBalancesGetter = store_mod.JustifiedBalancesGetter;
const computeTotalBalance = store_mod.computeTotalBalance;

fn hashFromByte(byte: u8) Root {
    var root: Root = ZERO_HASH;
    root[0] = byte;
    return root;
}

fn makeCheckpoint(epoch: Epoch, root: Root) Checkpoint {
    return .{ .epoch = epoch, .root = root };
}

fn dummyBalancesGetter(_: ?*anyopaque, _: Checkpoint, _: *CachedBeaconState) JustifiedBalances {
    return .empty;
}

const test_getter: JustifiedBalancesGetter = .{ .getFn = dummyBalancesGetter };

fn initTestStore(balances: []const u16) !ForkChoiceStore {
    var store: ForkChoiceStore = undefined;
    try store.init(
        testing.allocator,
        0,
        makeCheckpoint(0, hashFromByte(0x01)),
        makeCheckpoint(0, hashFromByte(0x01)),
        balances,
        test_getter,
        .{},
    );
    return store;
}

test "computeTotalBalance" {
    try testing.expectEqual(@as(u64, 0), computeTotalBalance(&.{}));
    try testing.expectEqual(@as(u64, 10), computeTotalBalance(&.{10}));
    try testing.expectEqual(@as(u64, 6), computeTotalBalance(&.{ 1, 2, 3 }));
    try testing.expectEqual(@as(u64, 130), computeTotalBalance(&.{ 65, 65 }));
}

test "Checkpoint.eql" {
    const root_a = hashFromByte(0x01);
    const root_b = hashFromByte(0x02);

    const cp_a: Checkpoint = .{ .epoch = 1, .root = root_a };
    const cp_b: Checkpoint = .{ .epoch = 1, .root = root_a };
    const cp_c: Checkpoint = .{ .epoch = 2, .root = root_a };
    const cp_d: Checkpoint = .{ .epoch = 1, .root = root_b };

    try testing.expect(cp_a.eql(cp_b));
    try testing.expect(!cp_a.eql(cp_c));
    try testing.expect(!cp_a.eql(cp_d));
}

test "init shares Rc between justified and unrealized_justified" {
    var store = try initTestStore(&.{ 10, 20, 30 });
    defer store.deinit(testing.allocator);

    // Both point to the same Rc (ref_count = 2).
    try testing.expectEqual(store.justified.balances, store.unrealized_justified.balances);
    try testing.expectEqual(@as(u64, 60), store.justified.total_balance);
    try testing.expectEqual(@as(u64, 60), store.unrealized_justified.total_balance);

    // Underlying data is the same.
    try testing.expectEqualSlices(u16, store.justified.balances.get().items, store.unrealized_justified.balances.get().items);
}

test "setJustified separates Rc from unrealized_justified" {
    var store = try initTestStore(&.{ 10, 20 });
    defer store.deinit(testing.allocator);

    const old_rc = store.justified.balances;
    const new_cp = makeCheckpoint(1, hashFromByte(0x02));

    try store.setJustified(testing.allocator, new_cp, &.{ 5, 5, 5 });

    // justified now has new Rc, unrealized_justified keeps old Rc.
    try testing.expect(store.justified.balances != old_rc);
    try testing.expectEqual(store.unrealized_justified.balances, old_rc);

    // Values updated correctly.
    try testing.expectEqual(@as(u64, 15), store.justified.total_balance);
    try testing.expectEqual(@as(u64, 30), store.unrealized_justified.total_balance);
    try testing.expectEqual(@as(Epoch, 1), store.justified.checkpoint.epoch);
}

test "setFinalizedCheckpoint updates and fires event" {
    const Tracker = struct {
        called: bool = false,
        last_epoch: Epoch = 0,

        fn onFinalized(ctx: ?*anyopaque, cp: Checkpoint) void {
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            self.called = true;
            self.last_epoch = cp.epoch;
        }
    };

    var tracker: Tracker = .{};
    var store: ForkChoiceStore = undefined;
    try store.init(
        testing.allocator,
        0,
        makeCheckpoint(0, hashFromByte(0x01)),
        makeCheckpoint(0, hashFromByte(0x01)),
        &.{},
        test_getter,
        .{ .on_finalized = .{ .context = @ptrCast(&tracker), .callFn = Tracker.onFinalized } },
    );
    defer store.deinit(testing.allocator);

    const new_cp = makeCheckpoint(3, hashFromByte(0x0F));
    store.setFinalizedCheckpoint(new_cp);

    try testing.expect(tracker.called);
    try testing.expectEqual(@as(Epoch, 3), tracker.last_epoch);
    try testing.expectEqual(@as(Epoch, 3), store.finalized_checkpoint.epoch);
}

test "setJustified fires onJustified event" {
    const Tracker = struct {
        called: bool = false,
        last_epoch: Epoch = 0,

        fn onJustified(ctx: ?*anyopaque, cp: Checkpoint) void {
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            self.called = true;
            self.last_epoch = cp.epoch;
        }
    };

    var tracker: Tracker = .{};
    var store: ForkChoiceStore = undefined;
    try store.init(
        testing.allocator,
        0,
        makeCheckpoint(0, hashFromByte(0x01)),
        makeCheckpoint(0, hashFromByte(0x01)),
        &.{},
        test_getter,
        .{ .on_justified = .{ .context = @ptrCast(&tracker), .callFn = Tracker.onJustified } },
    );
    defer store.deinit(testing.allocator);

    try store.setJustified(testing.allocator, makeCheckpoint(2, hashFromByte(0x0A)), &.{ 7, 8 });

    try testing.expect(tracker.called);
    try testing.expectEqual(@as(Epoch, 2), tracker.last_epoch);
}

test "deinit releases all Rc without leak" {
    // If deinit leaks, testing.allocator will report it.
    var store = try initTestStore(&.{ 1, 2, 3 });
    store.deinit(testing.allocator);
}
