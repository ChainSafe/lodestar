//! Times what a PQ validator and aggregator do: building a VRF tree, generating
//! a leanXMSS key, signing in and across bottom trees, and proving and verifying
//! an aggregate.
//!
//! Sizes come from the environment: `VRF_DEPTH` (default 20, the real tree is
//! 31), `SIGNATURES` (default 64) and `LOG_INV_RATE` (default 2).

const std = @import("std");
const c = @import("constants");
const leanvm = @import("leanvm");
const st = @import("state_transition");
const time = @import("time");
const VrfTree = @import("vrf_tree").VrfTree;

const xmss = leanvm.xmss;

fn envInt(init: std.process.Init, name: []const u8, default: u64) !u64 {
    const value = init.environ_map.get(name) orelse return default;
    return std.fmt.parseInt(u64, value, 10);
}

fn report(io: std.Io, label: []const u8, from: std.Io.Timestamp) void {
    std.debug.print("{s}: {d:.3} ms\n", .{ label, time.durationSeconds(time.since(io, from)) * 1e3 });
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const vrf_depth: u8 = @intCast(try envInt(init, "VRF_DEPTH", 20));
    const signatures: usize = @intCast(try envInt(init, "SIGNATURES", 64));
    const log_inv_rate: u32 = @intCast(try envInt(init, "LOG_INV_RATE", 2));
    const threads = std.Thread.getCpuCount() catch 1;

    var timer = time.start(io);
    var tree = try VrfTree.init(allocator, &@as([32]u8, @splat(1)), vrf_depth, threads);
    defer tree.deinit();
    std.debug.print("VRF tree of depth {d} on {d} threads: {d:.3} s\n", .{ vrf_depth, threads, time.durationSeconds(time.since(io, timer)) });
    timer = time.start(io);
    const proof = try tree.proof(0);
    report(io, "VRF proof, cold subtree", timer);
    std.debug.assert(st.pq.isValidVrfProof(&tree.root(), 0, &proof));

    timer = time.start(io);
    const key = try xmss.SecretKey.fromSeed(&@as(xmss.Seed, @splat(2)));
    defer key.deinit();
    report(io, "key generation", timer);
    const public_key = try key.publicKey();

    const message: xmss.Message = @splat(7);
    const attestation = st.pq.computeXmssAttestationLeafIndex;
    timer = time.start(io);
    const signature = try key.sign(&message, @intCast(attestation(0)));
    report(io, "attestation signature, cold bottom tree", timer);
    timer = time.start(io);
    for (1..65) |epoch| _ = try key.sign(&message, @intCast(attestation(epoch)));
    std.debug.print("attestation signature, warm: {d:.3} ms mean of 64\n", .{time.durationSeconds(time.since(io, timer)) * 1e3 / 64});
    timer = time.start(io);
    _ = try key.sign(&message, @intCast(st.pq.computeXmssLeafIndex(0, c.LEAF_OFFSET_BEACON_PROPOSER)));
    report(io, "block signature, other bottom tree", timer);
    timer = time.start(io);
    for (0..1000) |_| try xmss.verify(&public_key, &message, &signature);
    std.debug.print("verification: {d:.3} ms mean of 1000\n", .{time.durationSeconds(time.since(io, timer)) * 1e3 / 1000});

    // One key signing many messages costs the prover what many keys signing one does.
    const signed = try allocator.alloc(xmss.Signed, signatures);
    defer allocator.free(signed);
    for (signed, 0..) |*item, i| {
        item.public_key = public_key;
        item.message = @splat(0);
        std.mem.writeInt(u64, item.message[0..8], i, .little);
        item.signature = try key.sign(&item.message, @intCast(attestation(i)));
    }
    try leanvm.setup();
    for (0..2) |pass| {
        timer = time.start(io);
        const aggregate = try leanvm.aggregate(.{ .signed = signed }, log_inv_rate);
        defer aggregate.deinit();
        std.debug.print("aggregate of {d} signatures, pass {d}: {d:.3} s", .{ signatures, pass, time.durationSeconds(time.since(io, timer)) });
        const bytes = try aggregate.toBytes(allocator);
        defer allocator.free(bytes);
        std.debug.print(", {d} bytes\n", .{bytes.len});

        const claims = try aggregate.claims(allocator);
        defer allocator.free(claims);
        timer = time.start(io);
        const decoded = try leanvm.Proof.fromBytes(bytes, claims);
        defer decoded.deinit();
        try decoded.verify();
        report(io, "aggregate verification", timer);

        timer = time.start(io);
        const merged = try leanvm.aggregate(.{ .children = &.{ aggregate, aggregate } }, log_inv_rate);
        defer merged.deinit();
        std.debug.print("merge of 2 aggregates: {d:.3} s\n", .{time.durationSeconds(time.since(io, timer))});
    }
}
