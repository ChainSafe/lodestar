const std = @import("std");
const BoundedArray = @import("bounded_array").BoundedArray;
const Hash = @import("Hash.zig");
const Frame = @import("../fg/FinalityFrame.zig");
const Simulator = @import("Simulator.zig");
const finality_types = @import("../fg/finality_types.zig");
const types = @import("../types.zig");

const Vote = types.GoldfishVote;

test "semantic values ignore padding and inactive storage" {
    const Padded = struct { a: u8, b: u32 };
    var first: BoundedArray(u32, 4) = .{};
    var second: BoundedArray(u32, 4) = .{};
    first.push(7);
    second.push(7);
    var a: Padded = undefined;
    var b: Padded = undefined;
    @memset(std.mem.asBytes(&a), 0xaa);
    @memset(std.mem.asBytes(&b), 0x55);
    a.a = 1;
    a.b = 2;
    b.a = 1;
    b.b = 2;
    try std.testing.expectEqual(Hash.of(&a), Hash.of(&b));
    try std.testing.expectEqual(Hash.of(first), Hash.of(second));

    const State = struct { value: u32 };
    const Sigma = struct {
        T: BoundedArray(u32, 2),
        summaries: [2]State,
    };
    var first_sigma: Sigma = undefined;
    first_sigma.T = .{};
    first_sigma.T.push(1);
    first_sigma.summaries[0] = .{ .value = 9 };
    const second_sigma = first_sigma;
    try std.testing.expectEqual(Hash.of(first_sigma), Hash.of(second_sigma));

    second.push(8);
    const first_hash = Hash.of(first);
    const second_hash = Hash.of(second);
    try std.testing.expect(!std.mem.eql(u8, &first_hash, &second_hash));
}

test "unions, optionals, and structural node digest" {
    const Small = enum(u2) { first, second, third };
    _ = Hash.of(Small.third);
    const Value = struct {
        maybe: ?u32,
        choice: union(enum) { empty: void, number: u32 },
    };
    const empty = Value{ .maybe = null, .choice = .empty };
    const number = Value{ .maybe = 4, .choice = .{ .number = 4 } };
    const empty_hash = Hash.of(empty);
    const number_hash = Hash.of(number);
    try std.testing.expect(!std.mem.eql(u8, &empty_hash, &number_hash));

    const State = struct { value: u32 };
    const MockNode = struct {
        t: u32,
        next_tick: u32,
        awake: bool,
        stopped: bool,
        fg: State,
        ac: State,
        pool: State,
        Lambda: State,
        orphans: State,
        adapter: u32,
    };
    var first: MockNode = .{
        .t = 1,
        .next_tick = 2,
        .awake = true,
        .stopped = false,
        .fg = .{ .value = 3 },
        .ac = .{ .value = 4 },
        .pool = .{ .value = 7 },
        .Lambda = .{ .value = 5 },
        .orphans = .{ .value = 8 },
        .adapter = 6,
    };
    var second = first;
    second.adapter = 99;
    try std.testing.expectEqual(Hash.nodeDigest(&first), Hash.nodeDigest(&second));
    second.fg.value += 1;
    const first_digest = Hash.nodeDigest(&first);
    const second_digest = Hash.nodeDigest(&second);
    try std.testing.expect(!std.mem.eql(u8, &first_digest, &second_digest));
}

test "block root excludes root proposer and vote authentication" {
    const vote: Vote = .{ .val_index = 1, .slot = 1, .head = @splat(2) };
    var signed = Frame.SignedVote{ .vote = vote, .authenticated = false };
    var block: finality_types.Block = .{
        .root = @splat(3),
        .slot = 2,
        .parent = @splat(4),
        .proposer = 1,
        .ac_payload = .{ .votes = &.{signed}, .support_votes = &.{vote} },
    };
    const original = Hash.blockRoot(&block);
    block.root = @splat(8);
    block.proposer = 7;
    signed.authenticated = true;
    block.ac_payload.votes = &.{signed};
    try std.testing.expectEqual(original, Hash.blockRoot(&block));
}

test "heap allocated FG and Node use borrowed traversal" {
    const config: Simulator.Config = .{ .protocol = .{
        .B_gen = @splat(0),
        .n = 1,
        .val_index = 0,
        .ac = .{ .delta = 4, .R = 2, .k = 3 },
        .fg = .{ .delta_f = 4, .K_W = 2, .delta_t = 2 },
    } };
    const simulator = try Simulator.create(std.testing.allocator, &config);
    defer simulator.destroy();
    const node = simulator.node(0);
    _ = Hash.of(&node.fg);
    _ = Hash.nodeDigest(node);
}
