//! Tests for `AggregatePublicKey.zig`.

const std = @import("std");
const c = @import("root.zig").c;
const PublicKey = @import("root.zig").PublicKey;
const SecretKey = @import("SecretKey.zig");
const AggregatePublicKey = @import("AggregatePublicKey.zig");
const BatchAdder = AggregatePublicKey.BatchAdder;
const batch_add_len = AggregatePublicKey.batch_add_len;

const key_count = 48;

fn testKeys() ![key_count]PublicKey {
    var keys: [key_count]PublicKey = undefined;
    for (&keys, 0..) |*key, i| {
        var ikm: [32]u8 = @splat(0x5a);
        ikm[0] = @intCast(i);
        key.* = (try SecretKey.keyGen(&ikm, null)).toPublicKey();
    }
    return keys;
}

fn negated(key: *const PublicKey) PublicKey {
    var point: c.blst_p1 = undefined;
    c.blst_p1_from_affine(&point, &key.point);
    c.blst_p1_cneg(&point, true);
    var out: PublicKey = .{};
    c.blst_p1_to_affine(&out.point, &point);
    return out;
}

fn expectBatchMatchesSerial(keys: []const *const PublicKey) !void {
    var serial: AggregatePublicKey = .{};
    for (keys) |key| serial.add(key);

    var batched: AggregatePublicKey = .{};
    var adder = BatchAdder.init(&batched);
    for (keys) |key| adder.add(key);
    adder.finish();

    try std.testing.expectEqualSlices(
        u8,
        &serial.toPublicKey().compress(),
        &batched.toPublicKey().compress(),
    );
}

test "BatchAdder should match adding one key at a time" {
    const keys = try testKeys();
    var refs: [2 * batch_add_len + 37]*const PublicKey = undefined;

    // Distinct neighbours, across the serial threshold and the batch boundary.
    for (&refs, 0..) |*ref, i| ref.* = &keys[i % key_count];
    for ([_]usize{ 0, 1, 2, 47, 48, 49, batch_add_len - 1, batch_add_len, batch_add_len + 1, refs.len }) |count| {
        try expectBatchMatchesSerial(refs[0..count]);
    }

    // Equal neighbours: the batch adds a key to itself.
    for (&refs, 0..) |*ref, i| ref.* = &keys[(i / 2) % key_count];
    for ([_]usize{ 2, 48, 63, 96, refs.len }) |count| {
        try expectBatchMatchesSerial(refs[0..count]);
    }

    // Opposite neighbours: each pair cancels, and so does the whole sum.
    var opposites: [key_count]PublicKey = undefined;
    for (&opposites, &keys) |*opposite, *key| opposite.* = negated(key);
    for (&refs, 0..) |*ref, i| {
        const key = (i / 2) % key_count;
        ref.* = if (i % 2 == 0) &keys[key] else &opposites[key];
    }
    for ([_]usize{ 2, 3, 48, 49, 96, 97 }) |count| {
        try expectBatchMatchesSerial(refs[0..count]);
    }
}
