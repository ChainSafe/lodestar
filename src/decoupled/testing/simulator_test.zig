const std = @import("std");
const testing = std.testing;
const Simulator = @import("Simulator.zig");
const Hash = @import("Hash.zig");
const Storage = @import("Storage.zig");
const FG = @import("../fg/FinalityGadget.zig");
const types = @import("../types.zig");

const config: Simulator.Config = .{ .protocol = .{
    .B_gen = @splat(0),
    .n = 4,
    .val_index = 0,
    .ac = .{ .delta = 4, .R = 2, .k = 3 },
    .fg = .{ .delta_f = 4, .K_W = 2, .delta_t = 2 },
} };
fn slot(node: *const Simulator.Node, root: *const types.Root) u32 {
    return node.fg.T.buffer[node.fg.find(root).?].slot;
}
fn partition(sim: *Simulator, start: u32, end: u32) !void {
    for (0..4) |from| for (0..4) |to| {
        if (from / 2 == to / 2) continue;
        for ([_]Simulator.Channel{ .blocks_votes, .attestations }) |channel| {
            const link: Simulator.Link = .{ .from = @intCast(from), .to = @intCast(to), .channel = channel, .connected = false };
            try sim.schedule(start, .{ .link = link });
            var healed = link;
            healed.connected = true;
            try sim.schedule(end, .{ .link = healed });
        }
    };
}

test "simulation: Node routes shared, AC, and FG configuration to each component" {
    var options = config;
    options.protocol.B_gen = @splat(7);
    options.protocol.n = 5;
    options.protocol.ac = .{ .delta = 2, .R = 3, .k = 4 };
    options.protocol.fg = .{ .delta_f = 7, .K_W = 3, .delta_t = 5 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();

    const p = &options.protocol;
    for (sim.replicas, 0..) |*replica, i| {
        const node = &replica.node;
        try testing.expectEqual(p.B_gen, node.ac.config.genesis_root);
        try testing.expectEqual(p.B_gen, node.fg.config.B_gen);
        try testing.expectEqual(p.n, node.ac.config.validator_count);
        try testing.expectEqual(p.n, replica.state_source.config.n);
        try testing.expectEqual(@as(u32, @intCast(i)), node.ac.config.validator_index);
        try testing.expectEqual(@as(u32, @intCast(i)), node.Lambda.val_index);
        try testing.expectEqual(p.ac.delta, node.ac.config.delta);
        try testing.expectEqual(p.ac.R, node.ac.config.R);
        try testing.expectEqual(p.ac.k, node.ac.config.k);
        try testing.expectEqual(p.fg.delta_f, node.ac.config.delta_f);
        try testing.expectEqual(p.fg.K_W, replica.state_source.config.K_W);
        try testing.expectEqual(p.fg.delta_t, replica.state_source.config.delta_t);
    }
}

test "simulation: split configuration retains AC and FG validation" {
    var options = config;
    options.protocol.fg.delta_f = options.protocol.ac.delta - 1;
    try testing.expectError(error.InvalidConfig, Simulator.create(testing.allocator, &options));

    options = config;
    options.protocol.fg.delta_f = 9;
    try testing.expectError(error.InvalidConfig, Simulator.create(testing.allocator, &options));

    options = config;
    options.protocol.fg.K_W = 1;
    try testing.expectError(error.InvalidConfig, Simulator.create(testing.allocator, &options));
}

test "simulation: tick advances one instant and runUntil is the same driver" {
    const stepped = try Simulator.create(testing.allocator, &config);
    defer stepped.destroy();
    const batched = try Simulator.create(testing.allocator, &config);
    defer batched.destroy();
    try stepped.tick();
    try testing.expectEqual(@as(u32, 0), stepped.now);
    try testing.expectEqual(@as(u32, 1), stepped.next_time);
    try testing.expectEqual(config.protocol.ac.delta, stepped.node(0).next_tick);
    for (1..65) |_| try stepped.tick();
    try batched.runUntil(64);
    try testing.expectEqual(stepped.digest(), batched.digest());
}

test "simulation: healthy Nodes confirm and finalize with real FG/AC transitions" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try sim.runUntil(257);
    for (0..4) |v| {
        const node = sim.node(@intCast(v));
        try testing.expect(slot(node, &node.fg.F.root) >= 4);
        try testing.expect(slot(node, &node.ac.latest_confirmed) >= 8);
        try testing.expect(node.Lambda.sent.count >= 3);
        try testing.expect(!node.stopped);
    }
}

test "simulation: AC continues during an FG stall and finality resumes after validators wake" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    for ([_]u32{ 2, 3 }) |v| {
        try sim.schedule(0, .{ .sleep = v });
        try sim.schedule(128, .{ .wake = v });
    }
    try sim.runUntil(120);
    for (0..2) |v| {
        const node = sim.node(@intCast(v));
        try testing.expectEqual(config.protocol.B_gen, node.fg.F.root);
        try testing.expectEqual(@as(u32, 1), node.fg.h_max);
        try testing.expect(slot(node, &node.ac.latest_confirmed) >= 4);
    }
    try sim.runUntil(385);
    for (0..4) |v| {
        const node = sim.node(@intCast(v));
        try testing.expect(slot(node, &node.fg.F.root) >= 10);
        try testing.expect(!node.stopped);
    }
}

test "simulation: after a partition heals, block requests recover the blocks lost at send" {
    for ([_]bool{ false, true }) |block_requests| {
        var options = config;
        options.block_requests = block_requests;
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        try partition(sim, 32, 160);
        try sim.runUntil(49);
        const missed = sim.node(2).fg.T.buffer[2].root;
        try testing.expectEqual(@as(u32, 2), slot(sim.node(2), &missed));
        try testing.expect(sim.node(0).fg.find(&missed) == null);
        try sim.runUntil(159);
        try testing.expect(sim.node(0).fg.find(&missed) == null);
        try sim.runUntil(385);
        try testing.expectEqual(block_requests, sim.node(0).fg.find(&missed) != null);
        try testing.expect(sim.links[0][2][0]);
        var drops: u32 = 0;
        var requests: u32 = 0;
        var served: u32 = 0;
        for (sim.trace.constSlice()) |entry| {
            if (entry.kind == .drop) drops += 1;
            if (entry.kind == .block_request) {
                try testing.expect(entry.time >= 160);
                requests += 1;
            }
            if (entry.kind == .block_response and entry.value == 1) served += 1;
        }
        try testing.expect(drops > 0);
        try testing.expectEqual(block_requests, requests > 0);
        try testing.expectEqual(block_requests, served > 0);
        if (!block_requests) continue;
        for (0..4) |v| {
            const node = sim.node(@intCast(v));
            try testing.expectEqual(@as(u32, 0), node.orphans.count);
            try testing.expectEqual(sim.node(0).fg.F.root, node.fg.F.root);
            try testing.expect(slot(node, &node.fg.F.root) > 10);
        }
    }
}

test "simulation: one-time relays use the forwarding link and do not retry in-flight loss" {
    for ([_]bool{ false, true }) |cut_relay| {
        var options = config;
        options.blocks_votes = .{ .min = 4, .max = 4 };
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();

        for ([_][2]u32{ .{ 1, 2 }, .{ 0, 1 }, .{ 0, 3 } }) |pair| {
            try sim.schedule(0, .{ .link = .{
                .from = pair[0],
                .to = pair[1],
                .channel = .blocks_votes,
                .connected = false,
            } });
        }
        if (cut_relay) {
            var link: Simulator.Link = .{ .from = 0, .to = 2, .channel = .blocks_votes, .connected = false };
            try sim.schedule(22, .{ .link = link });
            link.connected = true;
            try sim.schedule(25, .{ .link = link });
        }
        var B: FG.Block = .{ .root = undefined, .parent = config.protocol.B_gen, .slot = 1, .proposer = 1 };
        B.root = Hash.blockRoot(&B);
        const packet = try sim.injectBlock(16, 1, 1, &B, true);
        try sim.runUntil(49);
        try testing.expect(sim.node(0).fg.find(&B.root) != null);
        try testing.expectEqual(!cut_relay, sim.node(2).fg.find(&B.root) != null);
        try testing.expect(sim.links[0][0][2]);
        var queued: u32 = 0;
        var arrivals: u32 = 0;
        for (sim.trace.constSlice()) |entry| {
            if (entry.packet != packet or entry.node != 2 or entry.peer != 0) continue;
            if (entry.kind == .queued) {
                try testing.expectEqual(@as(u32, 20), entry.time);
                try testing.expectEqual(@as(u32, 0), entry.peer);
                queued += 1;
            }
            if (entry.kind == .deliver or entry.kind == .drop) {
                try testing.expectEqual(@as(u32, 24), entry.time);
                try testing.expectEqual(@as(u32, 0), entry.peer);
                try testing.expectEqual(if (cut_relay) Simulator.Kind.drop else .deliver, entry.kind);
                arrivals += 1;
            }
        }
        try testing.expectEqual(@as(u32, 1), queued);
        try testing.expectEqual(@as(u32, 1), arrivals);
    }
}

test "simulation: Byzantine block withholding is not undone by originator reannouncement" {
    var options = config;
    options.fuzz = .{
        .byzantine = 1,
        .first_slot = 1,
        .last_slot = 1,
        .process_fault_slots = 1,
        .network_fault_slots = 0,
        .drop_rate = 1000,
        .late_rate = 0,
        .mutation_rate = 0,
    };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectEqual(@as(u64, 2), sim.plan.byzantine);
    try sim.runUntil(64);
    const withheld = sim.node(1).fg.T.buffer[1].root;
    try testing.expectEqual(@as(u32, 1), slot(sim.node(1), &withheld));
    for ([_]u32{ 0, 2, 3 }) |v| try testing.expect(sim.node(v).fg.find(&withheld) == null);
    var block_drops: u32 = 0;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind != .fuzz or entry.value != Simulator.fuzz_drop) continue;
        if (sim.packets.buffer[entry.packet].body == .block) block_drops += 1;
    }
    try testing.expectEqual(@as(u32, 3), block_drops);
}

test "simulation: a child refused for a missing parent is kept and accepted when the parent arrives" {
    for ([_]bool{ false, true }) |block_requests| {
        var options = config;
        options.block_requests = block_requests;
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        var parent: FG.Block = .{ .root = undefined, .parent = config.protocol.B_gen, .slot = 1, .proposer = 1 };
        parent.root = Hash.blockRoot(&parent);
        var child: FG.Block = .{ .root = undefined, .parent = parent.root, .slot = 2, .proposer = 2 };
        child.root = Hash.blockRoot(&child);
        _ = try sim.injectBlock(20, 2, 1, &child, false);
        const refused = try sim.injectBlock(32, 2, 1, &child, true);
        _ = try sim.injectBlock(40, 1, 1, &parent, true);
        // An unauthenticated block is neither kept nor a reason to ask for its parent.
        try sim.runUntil(31);
        try testing.expectEqual(@as(u32, 0), sim.node(0).orphans.count);
        try sim.runUntil(40);
        try testing.expectEqual(@as(u32, 1), sim.node(0).orphans.count);
        try testing.expect(sim.node(0).fg.find(&child.root) == null);
        // Node releases the kept child inside the parent's delivery, with or without requests.
        try sim.runUntil(41);
        try testing.expect(sim.node(0).fg.find(&parent.root) != null);
        try testing.expect(sim.node(0).fg.find(&child.root) != null);
        try testing.expectEqual(@as(u32, 0), sim.node(0).orphans.count);
        try sim.runUntil(80);
        var receipts: u32 = 0;
        var requests: u32 = 0;
        var unanswered: u32 = 0;
        for (sim.trace.constSlice()) |entry| {
            if (entry.kind == .block_request) {
                try testing.expectEqual(@as(u32, 33), entry.time);
                try testing.expectEqual(refused, entry.packet);
                requests += 1;
            }
            // The injecting node never accepted the parent, so it has nothing to answer with.
            if (entry.kind == .block_response) {
                try testing.expectEqual(@as(u32, 2), entry.node);
                try testing.expectEqual(@as(u64, 0), entry.value);
                unanswered += 1;
            }
            // After the release, peers relay the child back as a duplicate.
            if (entry.kind != .deliver or entry.packet != refused or entry.time > 41) continue;
            try testing.expectEqual(@as(u32, 33), entry.time);
            try testing.expectEqual(@as(u64, 0), entry.value);
            receipts += 1;
        }
        try testing.expectEqual(@as(u32, 1), receipts);
        try testing.expectEqual(@as(u32, @intFromBool(block_requests)), requests);
        try testing.expectEqual(@as(u32, @intFromBool(block_requests)), unanswered);
    }
}

test "simulation: a crashed node rebuilt from storage equals the node that only slept" {
    var digests: [2][4]types.Root = undefined;
    for ([_]bool{ false, true }, 0..) |crash, run| {
        const sim = try Simulator.create(testing.allocator, &config);
        defer sim.destroy();
        try sim.schedule(200, if (crash) .{ .crash = 2 } else .{ .sleep = 2 });
        try sim.schedule(264, .{ .wake = 2 });
        try sim.runUntil(200);
        // The node goes down with blocks, pool entries, a signing record and a moved AC record.
        const storage = &sim.replicas[2].storage;
        try testing.expect(sim.node(2).fg.T.count > 8);
        try testing.expect(storage.journal.count > sim.node(2).fg.T.count);
        try testing.expect(storage.record.sent.count > 0);
        try testing.expect(storage.ac != null);
        try testing.expectEqual(crash, sim.replicas[2].crashed);
        try sim.runUntil(264);
        try testing.expect(!sim.replicas[2].crashed);
        try testing.expect(sim.node(2).awake);
        try sim.runUntil(450);
        for (0..4) |v| {
            const node = sim.node(@intCast(v));
            try testing.expect(!node.stopped);
            try testing.expect(slot(node, &node.fg.F.root) > 12);
            digests[run][v] = Hash.nodeDigest(node);
        }
    }
    for (0..4) |v| try testing.expectEqual(digests[0][v], digests[1][v]);
}

test "simulation: a restore replays the journal in order and loses only kept orphans" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    var parent: FG.Block = .{ .root = undefined, .parent = config.protocol.B_gen, .slot = 1, .proposer = 1 };
    parent.root = Hash.blockRoot(&parent);
    var child: FG.Block = .{ .root = undefined, .parent = parent.root, .slot = 2, .proposer = 2 };
    child.root = Hash.blockRoot(&child);
    // Node 0 misses the parent, so it keeps the child and never accepts it.
    _ = try sim.injectBlock(32, 2, 1, &child, true);
    try sim.schedule(100, .{ .crash = 0 });
    try sim.schedule(104, .{ .wake = 0 });
    try sim.runUntil(100);
    try testing.expectEqual(@as(u32, 1), sim.node(0).orphans.count);
    const blocks = sim.node(0).fg.T.count;
    const pool = sim.node(0).pool.entries.count;
    const finalized = sim.node(0).fg.F.root;
    try testing.expect(blocks > 4);
    try sim.runUntil(104);
    const node = sim.node(0);
    try testing.expectEqual(@as(u32, 0), node.orphans.count);
    try testing.expectEqual(blocks, node.fg.T.count);
    try testing.expectEqual(pool, node.pool.entries.count);
    try testing.expectEqual(finalized, node.fg.F.root);
    try testing.expectEqual(sim.replicas[0].storage.record.sent.count, node.Lambda.sent.count);
}

test "simulation: a node that dies inside any write is rebuilt and rejoins" {
    var kinds = std.enums.EnumSet(Storage.Write).initEmpty();
    // Nine consecutive writes cover a slot: four ticks, a block, and four attestations.
    for (0..9) |skip| {
        for ([_]bool{ false, true }) |applied| {
            var options = config;
            options.snapshots = false;
            const sim = try Simulator.create(testing.allocator, &options);
            defer sim.destroy();
            try sim.schedule(200, .{ .crash_at_write = .{
                .node = 2,
                .point = .{ .skip = @intCast(skip), .applied = applied },
            } });
            try sim.runUntil(450);
            try testing.expect(!sim.failed);
            var crashes: u32 = 0;
            for (sim.trace.constSlice()) |entry| {
                if (entry.kind != .crash) continue;
                try testing.expectEqual(@as(u32, 2), entry.node);
                try testing.expect(entry.time >= 200);
                // The node is rebuilt at the start of the next slot.
                try testing.expectEqual(@as(u64, (entry.time / 16 + 1) * 16), entry.value);
                crashes += 1;
            }
            try testing.expectEqual(@as(u32, 1), crashes);
            try testing.expect(sim.replicas[2].storage.crash == null);
            try testing.expect(!sim.replicas[2].crashed);
            kinds.insert(sim.replicas[2].storage.died_in.?);
            for (0..4) |v| {
                const node = sim.node(@intCast(v));
                try testing.expect(node.awake and !node.stopped);
                try testing.expect(sim.tips(@intCast(v)).finalized.slot > 12);
            }
            // Nothing is on the wire that the durable signing record lacks.
            const record = &sim.replicas[2].storage.record;
            try testing.expectEqual(record.sent.count, sim.node(2).Lambda.sent.count);
            for (sim.packets.constSlice()) |*packet| {
                if (packet.body != .attestation or packet.validator != 2) continue;
                const sent = for (record.sent.constSlice()) |*held| {
                    if (held.contentEql(&packet.body.attestation)) break true;
                } else false;
                try testing.expect(sent);
            }
        }
    }
    // The nine points reach every kind of write the node makes.
    try testing.expectEqual(@as(usize, 4), kinds.count());
}

test "fuzz: crash points are drawn after the rest of the plan and leave it unchanged" {
    var options = fuzz_config;
    options.snapshots = false;
    const plain = try Simulator.create(testing.allocator, &options);
    defer plain.destroy();
    options.fuzz.?.crash_writes = 3;
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectEqual(plain.plan.byzantine, sim.plan.byzantine);
    try testing.expectEqual(plain.plan.process_slots, sim.plan.process_slots);
    try testing.expectEqual(plain.plan.network_slots, sim.plan.network_slots);
    try testing.expectEqual(plain.plan.groups, sim.plan.groups);
    for (plain.plan.crashes) |crash| try testing.expect(crash == null);
    var planned: u32 = 0;
    for (sim.plan.crashes) |crash| {
        const point = crash orelse continue;
        try testing.expect(point.slot >= options.fuzz.?.first_slot and point.slot <= options.fuzz.?.last_slot);
        try testing.expect(point.node < sim.replicas.len);
        planned += 1;
    }
    try testing.expectEqual(@as(u32, 3), planned);
    try sim.runUntil(fuzz_end);
    try testing.expect(!sim.failed);
    var armed: u32 = 0;
    var died: u32 = 0;
    var woke: u32 = 0;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind == .fuzz and entry.value == Simulator.fuzz_crash) armed += 1;
        if (entry.kind == .crash) died += 1;
        if (entry.kind == .wake) woke += 1;
    }
    try testing.expectEqual(@as(u32, 3), armed);
    try testing.expect(died > 0);
    try testing.expectEqual(died, woke);
}

test "simulation: seeded delivery and controls replay protocol snapshots and complete event order" {
    var options = config;
    options.blocks_votes = .{ .min = 0, .max = 4 };
    options.attestations = .{ .min = 2, .max = 4 };
    options.seed = 0x1234;
    const first = try Simulator.create(testing.allocator, &options);
    defer first.destroy();
    const second = try Simulator.create(testing.allocator, &options);
    defer second.destroy();
    for ([_]*Simulator{ first, second }) |sim| {
        try sim.schedule(47, .{ .sleep = 1 });
        try sim.schedule(97, .{ .wake = 1 });
        try partition(sim, 128, 160);
        try sim.runUntil(257);
    }
    try testing.expectEqual(first.digest(), second.digest());
    try testing.expectEqualDeep(first.trace.constSlice(), second.trace.constSlice());
    for (0..4) |v| {
        try testing.expectEqual(
            Hash.nodeDigest(first.node(@intCast(v))),
            Hash.nodeDigest(second.node(@intCast(v))),
        );
    }
}

test "simulation: zero-latency arrivals still follow every receiver's public tick" {
    var options = config;
    options.blocks_votes = .{ .min = 0, .max = 0 };
    options.attestations = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try sim.runUntil(128);
    var time: ?u32 = null;
    var delivered = false;
    for (sim.trace.constSlice()) |entry| {
        if (time != entry.time) {
            time = entry.time;
            delivered = false;
        }
        if (entry.kind == .deliver) delivered = true;
        if (entry.kind == .tick) try testing.expect(!delivered);
    }
    try testing.expect(slot(sim.node(0), &sim.node(0).fg.F.root) > 0);
}

test "simulation: sleeping receivers retain in-flight and newly sent objects until wake" {
    var options = config;
    options.blocks_votes = .{ .min = 4, .max = 4 };
    options.attestations = .{ .min = 4, .max = 4 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try sim.schedule(6, .{ .sleep = 1 });
    try sim.schedule(33, .{ .wake = 1 });
    try sim.runUntil(80);
    var retained: u32 = 0;
    var after_wake: u32 = 0;
    for (sim.trace.constSlice()) |entry| {
        if (entry.node != 1) continue;
        if (entry.kind == .retained) retained += 1;
        if (entry.kind == .deliver) {
            try testing.expect(entry.time < 6 or entry.time >= 37);
            if (entry.time == 37) after_wake += 1;
        }
        if (entry.kind == .tick) try testing.expect(entry.time < 6 or entry.time >= 36);
    }
    try testing.expect(retained > 0);
    try testing.expect(after_wake > 0);
    try testing.expectEqual(@as(?u32, 33), sim.node(1).ac.restart_time);
}

test "simulation: Node authenticates signed votes before AC tuple admission" {
    var options = config;
    options.blocks_votes = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();

    const vote: types.GoldfishVote = .{ .val_index = 0, .slot = 0, .head = config.protocol.B_gen };
    _ = try sim.injectVote(0, 0, 0, &vote, true);
    const forged = try sim.injectVote(1, 0, 2, &vote, false);
    const wrong_signer = try sim.injectVote(1, 2, 2, &vote, true);
    try sim.runUntil(1);
    try testing.expectEqual(@as(u32, 0), sim.node(1).ac.pools[0].count);
    var rejected: u32 = 0;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind != .deliver or (entry.packet != forged and entry.packet != wrong_signer)) continue;
        const unauthenticated = @intFromEnum(@import("../Node.zig").Admission.unauthenticated);
        try testing.expectEqual(@as(u64, unauthenticated), entry.value);
        rejected += 1;
    }
    try testing.expectEqual(@as(u32, 2), rejected);

    _ = try sim.injectVote(2, 0, 2, &vote, true);
    try sim.runUntil(2);
    const pool = &sim.node(1).ac.pools[0];
    try testing.expectEqual(@as(u32, 1), pool.count);
    try testing.expect(vote.eql(&pool.buffer[0].vote));
    try testing.expectEqual(@as(u32, 2), pool.buffer[0].timestamp);
}

test "simulation: signature witnesses do not authenticate forged or malformed attestations" {
    var options = config;
    options.attestations = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    var a: FG.Attestation = .{ .val_index = 0, .h = 1000, .T = @splat(0), .tau = true };
    _ = try sim.injectAttestation(0, 0, 0, &a, true);
    _ = try sim.injectAttestation(0, 0, 2, &a, false);
    a.val_index = 4;
    _ = try sim.injectAttestation(0, 0, 2, &a, true);
    a.val_index = 0;
    a.h_f = 1000;
    a.T_f = @splat(0);
    _ = try sim.injectAttestation(0, 0, 2, &a, true);
    try sim.runUntil(0);
    try testing.expectEqual(@as(u32, 0), sim.node(1).pool.entries.count);
    a.h_f = null;
    a.T_f = null;
    _ = try sim.injectAttestation(1, 0, 2, &a, true);
    try sim.runUntil(1);
    try testing.expectEqual(@as(u32, 1), sim.node(1).pool.entries.count);
}

test "simulation: a failed durable write stops the node before that tick sends anything" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try sim.schedule(56, .{ .storage_failure = .{ .node = 0, .enabled = true } });
    try testing.expectError(error.PersistenceFailed, sim.runUntil(56));
    try testing.expect(sim.failed);
    try testing.expect(sim.node(0).stopped);
    // The tick's first write is the AC record, ahead of the vote and of the attestation.
    try testing.expect(!sim.node(0).ac.durable().eql(&sim.node(0).ac_saved));
    try testing.expectEqual(@as(u32, 0), sim.replicas[0].storage.record.sent.count);
    for (sim.packets.constSlice()) |*packet| {
        try testing.expect(packet.body != .attestation);
        try testing.expect(packet.sender != 0 or packet.created != 56);
    }
    try testing.expectError(error.IncompleteRun, sim.runUntil(60));
}

test "simulation: an invalid block packet cannot borrow another packet's signature witness" {
    var options = config;
    options.blocks_votes = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    var B: FG.Block = .{
        .root = undefined,
        .parent = config.protocol.B_gen,
        .slot = 1,
        .proposer = 1,
    };
    B.root = Hash.blockRoot(&B);
    _ = try sim.injectBlock(16, 1, 0, &B, true);
    const forged = try sim.injectBlock(16, 1, 1, &B, false);
    try sim.runUntil(16);
    var found = false;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind == .deliver and entry.packet == forged) {
            try testing.expectEqual(@as(u64, 0), entry.value);
            found = true;
        }
    }
    try testing.expect(found);
    try testing.expect(sim.node(0).fg.find(&B.root) == null);
}

test "checks: a healthy run satisfies safety and both progress checks" {
    var options = config;
    // Two rounds: every round advances a height when a quorum attests.
    options.checks.height_progress_bound = 2 * 4 * options.protocol.ac.delta * options.protocol.ac.R;
    options.checks.finalization_bound = 160;
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try sim.runUntil(257);
    try testing.expect(!sim.failed);
    try testing.expect(sim.confirmationPremises());
    try testing.expect(sim.last_height_progress > 0);
    try testing.expectEqual(Simulator.Verdict.passed, sim.verdict());
    try testing.expectEqual(@as(u32, 65), sim.coverage.finalization.active);
    try testing.expectEqual(@as(u32, 0), sim.coverage.finalization.skipped);
    for (sim.replicas) |*replica| try testing.expect(replica.last_finalization > 0);
}

test "checks: an unreachable height-progress bound is a property failure" {
    var options = config;
    options.checks.height_progress_bound = 1;
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectError(error.HeightProgressStall, sim.runUntil(16));
    try testing.expect(sim.failed);
    try testing.expectEqual(error.HeightProgressStall, sim.failure.?);
    try testing.expectEqual(Simulator.Verdict.property_failure, sim.verdict());
    try testing.expectError(error.IncompleteRun, sim.runUntil(20));
}

test "checks: compatibility walks the global block store" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    var first: FG.Block = .{ .root = undefined, .parent = config.protocol.B_gen, .slot = 1, .proposer = 1 };
    first.root = Hash.blockRoot(&first);
    var second: FG.Block = .{ .root = undefined, .parent = first.root, .slot = 2, .proposer = 2 };
    second.root = Hash.blockRoot(&second);
    var fork: FG.Block = .{ .root = undefined, .parent = config.protocol.B_gen, .slot = 2, .proposer = 2 };
    fork.root = Hash.blockRoot(&fork);
    _ = try sim.injectBlock(0, 1, 0, &first, true);
    _ = try sim.injectBlock(0, 2, 0, &second, true);
    _ = try sim.injectBlock(0, 2, 0, &fork, true);
    try testing.expect(sim.compatible(&first.root, &second.root));
    try testing.expect(sim.compatible(&second.root, &first.root));
    try testing.expect(sim.compatible(&config.protocol.B_gen, &fork.root));
    try testing.expect(sim.compatible(&fork.root, &fork.root));
    try testing.expect(!sim.compatible(&second.root, &fork.root));
    try testing.expect(!sim.compatible(&first.root, &fork.root));
    const unknown: types.Root = @splat(9);
    try testing.expect(!sim.compatible(&unknown, &first.root));
}

test "checks: confirmation premises pause during an honest partition and resume after the lock window" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try testing.expect(sim.confirmationPremises());
    try partition(sim, 16, 48);
    try sim.runUntil(20);
    try testing.expect(!sim.confirmationPremises());
    try testing.expectEqual(@as(?u32, 20), sim.last_honest_cut);
    try sim.runUntil(127);
    try testing.expectEqual(@as(?u32, 48), sim.last_honest_cut);
    try testing.expect(!sim.confirmationPremises());
    try sim.runUntil(128);
    try testing.expect(sim.confirmationPremises());
    // One faulty identity out of four keeps the honest majority; an injected vote marks its
    // sender faulty but does not pause the premises.
    _ = try sim.injectVote(129, 0, 0, &.{ .val_index = 0, .slot = 8, .head = config.protocol.B_gen }, true);
    try sim.runUntil(129);
    try testing.expect(sim.confirmationPremises());
}

test "simulation: different seeds change schedules and bounded seed sweeps retain local invariants" {
    var previous: ?types.Root = null;
    for (0..4) |seed| {
        var options = config;
        options.seed = seed;
        options.blocks_votes = .{ .min = 0, .max = 4 };
        options.attestations = .{ .min = 0, .max = 4 };
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        try sim.runUntil(193);
        const digest = sim.digest();
        if (previous) |p| try testing.expect(!std.mem.eql(u8, &p, &digest));
        previous = digest;
    }
}

const fuzz_config: Simulator.Config = .{
    .protocol = .{
        .B_gen = @splat(0),
        .n = 7,
        .val_index = 0,
        .ac = .{ .delta = 4, .R = 2, .k = 3 },
        .fg = .{ .delta_f = 4, .K_W = 2, .delta_t = 2 },
    },
    .blocks_votes = .{ .min = 0, .max = 4 },
    .attestations = .{ .min = 0, .max = 4 },
    .fuzz = .{
        .byzantine = 2,
        .process_fault_slots = 3,
        .network_fault_slots = 2,
        .first_slot = 1,
        .last_slot = 10,
    },
    // Four rounds of two slots without a height advance is a stall.
    .checks = .{ .height_progress_bound = 4 * 4 * 4 * 2 },
};
// Slots 0 to 23: faults end by slot 10, then a fault-free suffix of more than four rounds.
const fuzz_end: u32 = 4 * 4 * 24 - 1;

fn planSlotsValid(slots: *const [Simulator.max_fault_slots]?u32, count: u32) !void {
    const fuzz = fuzz_config.fuzz.?;
    for (slots, 0..) |entry, i| {
        if (i < count) {
            const s = entry orelse return error.TestUnexpectedResult;
            try testing.expect(s >= fuzz.first_slot and s <= fuzz.last_slot);
            for (slots[0..i]) |earlier| try testing.expect(earlier.? != s);
        } else {
            try testing.expectEqual(@as(?u32, null), entry);
        }
    }
}

test "fuzz: the plan is drawn from the seed, marks Byzantine nodes faulty, and replays" {
    const first = try Simulator.create(testing.allocator, &fuzz_config);
    defer first.destroy();
    const second = try Simulator.create(testing.allocator, &fuzz_config);
    defer second.destroy();
    var other_options = fuzz_config;
    other_options.seed = fuzz_config.seed + 1;
    const other = try Simulator.create(testing.allocator, &other_options);
    defer other.destroy();
    try testing.expectEqual(@as(u32, 2), @popCount(first.plan.byzantine));
    try testing.expectEqual(first.plan.byzantine, first.faulty);
    try planSlotsValid(&first.plan.process_slots, 3);
    try planSlotsValid(&first.plan.network_slots, 2);
    for (0..2) |i| {
        try testing.expect(first.plan.group_count[i] >= 2 and first.plan.group_count[i] <= 3);
        try testing.expect(first.plan.channels[i] >= 1 and first.plan.channels[i] <= 3);
    }
    try testing.expectEqualDeep(first.plan, second.plan);
    try first.runUntil(fuzz_end);
    try second.runUntil(fuzz_end);
    try other.runUntil(fuzz_end);
    try testing.expectEqual(first.digest(), second.digest());
    try testing.expectEqualDeep(first.trace.constSlice(), second.trace.constSlice());
    try testing.expect(!std.mem.eql(u8, &first.digest(), &other.digest()));
}

test "fuzz: Byzantine objects are dropped, delayed, or mutated only by Byzantine senders in process-fault slots" {
    const sim = try Simulator.create(testing.allocator, &fuzz_config);
    defer sim.destroy();
    try sim.runUntil(fuzz_end);
    var mutations: u32 = 0;
    var drops: u32 = 0;
    var lates: u32 = 0;
    var partitions: u32 = 0;
    const slot_length = 4 * fuzz_config.protocol.ac.delta;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind != .fuzz) continue;
        if (entry.value == Simulator.fuzz_partition) {
            partitions += 1;
            try testing.expect(sim.networkFaultSlot(entry.time / slot_length) != null);
            continue;
        }
        if (entry.value == Simulator.fuzz_heal) continue;
        try testing.expect(sim.plan.byzantine & (@as(u64, 1) << @intCast(entry.peer)) != 0);
        try testing.expect(sim.processFaultSlot(entry.time / slot_length));
        switch (entry.value) {
            Simulator.fuzz_drop => drops += 1,
            Simulator.fuzz_late => lates += 1,
            else => {
                mutations += 1;
                const packet = sim.packets.buffer[entry.packet];
                try testing.expect(packet.authenticated);
                try testing.expectEqual(entry.peer, packet.sender);
                try testing.expectEqual(entry.time, packet.created);
            },
        }
    }
    try testing.expectEqual(@as(u32, 2), partitions);
    try testing.expect(mutations > 0);
    try testing.expect(drops + lates > 0);
}

test "fuzz: a seed sweep keeps the cluster checks satisfied with two of seven Byzantine" {
    var equivocation_seen = false;
    for (1..4) |seed| {
        var options = fuzz_config;
        options.seed = seed;
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        try sim.runUntil(fuzz_end);
        try testing.expect(!sim.failed);
        for (sim.replicas, 0..) |*replica, v| {
            if (sim.plan.byzantine & (@as(u64, 1) << @intCast(v)) != 0) continue;
            for (&replica.node.ac.pools) |*pool| {
                var counts: [Simulator.max_nodes]u32 = @splat(0);
                for (pool.constSlice()) |*entry| counts[entry.vote.val_index] += 1;
                for (counts) |count| if (count == 2) {
                    equivocation_seen = true;
                };
            }
        }
    }
    try testing.expect(equivocation_seen);
}

test "twins: two replicas share one identity, equivocate under a split view, and the checks hold" {
    var options = config;
    options.twins = 1;
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectEqual(@as(usize, 5), sim.replicas.len);
    try testing.expectEqual(@as(u32, 0), sim.replicas[4].validator);
    try testing.expectEqual(@as(u32, 0), sim.replicas[4].node.Lambda.val_index);
    try testing.expectEqual(@as(u64, 1), sim.faulty);
    // Split the twin's view from its sibling's for slots 1 to 4 on the vote channel.
    for ([_]u32{ 1, 2 }) |peer| {
        for ([_][2]u32{ .{ 4, peer }, .{ peer, 4 } }) |pair| {
            var link: Simulator.Link = .{ .from = pair[0], .to = pair[1], .channel = .blocks_votes, .connected = false };
            try sim.schedule(16, .{ .link = link });
            link.connected = true;
            try sim.schedule(80, .{ .link = link });
        }
    }
    try sim.runUntil(257);
    try testing.expect(!sim.failed);
    // Validator 0 proposes at slots 0 mod 4; with two views, some slot got two different blocks.
    var equivocated = false;
    for (sim.blocks.constSlice(), 0..) |*a, i| {
        if (a.proposer != 0) continue;
        for (sim.blocks.constSlice()[i + 1 ..]) |*b| {
            if (b.proposer == 0 and b.slot == a.slot and !std.mem.eql(u8, &a.root, &b.root)) {
                equivocated = true;
            }
        }
    }
    try testing.expect(equivocated);
    // Honest replicas still agree on finality.
    const F = sim.replicas[1].node.fg.F.root;
    for ([_]u32{ 2, 3 }) |v| try testing.expectEqual(F, sim.replicas[v].node.fg.F.root);
    try testing.expect(sim.replicas[1].node.fg.T.buffer[sim.replicas[1].node.fg.find(&F).?].slot > 0);
}

test "twins: a fuzz plan lends its first Byzantine identity to the twin" {
    var options = fuzz_config;
    options.twins = 1;
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectEqual(@as(usize, 8), sim.replicas.len);
    try testing.expectEqual(@as(u32, @ctz(sim.plan.byzantine)), sim.replicas[7].validator);
    try testing.expectEqual(sim.plan.byzantine, sim.faulty);
    try sim.runUntil(fuzz_end);
    try testing.expect(!sim.failed);
}

test "height progress: first advance delay is not a recovery metric" {
    const healthy = try Simulator.create(testing.allocator, &config);
    defer healthy.destroy();
    try testing.expectEqual(@as(?u32, null), healthy.firstHeightProgressDelay());
    try healthy.runUntil(128);
    try testing.expectEqual(@as(u32, 0), healthy.last_fault);
    try testing.expect(healthy.first_height_progress_after_fault.? <= healthy.last_height_progress);
    try testing.expectEqual(healthy.first_height_progress_after_fault, healthy.firstHeightProgressDelay());
    const fuzzed = try Simulator.create(testing.allocator, &fuzz_config);
    defer fuzzed.destroy();
    try fuzzed.runUntil(fuzz_end);
    try testing.expect(fuzzed.last_fault > 0);
    const delay = fuzzed.firstHeightProgressDelay() orelse return error.TestUnexpectedResult;
    try testing.expect(delay > 0);
    try testing.expectEqual(fuzzed.last_fault + delay, fuzzed.first_height_progress_after_fault.?);
}

test "height progress: an advance at the fault instant remains the first advance" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try sim.schedule(64, .{ .storage_failure = .{ .node = 0, .enabled = false } });
    try sim.runUntil(64);
    try testing.expectEqual(@as(?u32, 0), sim.firstHeightProgressDelay());
    try sim.runUntil(96);
    try testing.expectEqual(@as(?u32, 0), sim.firstHeightProgressDelay());
    try sim.schedule(101, .{ .storage_failure = .{ .node = 0, .enabled = false } });
    try sim.runUntil(101);
    try testing.expectEqual(@as(?u32, null), sim.firstHeightProgressDelay());
    try sim.runUntil(128);
    try testing.expectEqual(@as(?u32, 27), sim.firstHeightProgressDelay());
}

test "checks: disabled finalization fails even while real Nodes advance heights" {
    for ([_]bool{ true, false }) |all_nodes| {
        var options = config;
        options.snapshots = false;
        options.checks = .{ .height_progress_bound = 128, .finalization_bound = 160 };
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        for (0..165) |t| {
            // Negative control, not a feasible protocol execution: erase pending finality.
            for (sim.replicas, 0..) |*replica, v| {
                if (!all_nodes and v != 1) continue;
                const source = &replica.state_source;
                for (source.states[0..source.roots.count]) |*state| {
                    state.pending_finality = .{};
                }
            }
            if (t < 164) try sim.tick() else try testing.expectError(error.FinalizationStall, sim.tick());
        }
        try testing.expect(sim.finalizationPremises());
        try testing.expectEqual(Simulator.Verdict.property_failure, sim.verdict());
        try testing.expectEqual(@as(u32, 0), sim.node(1).fg.F.slot);
        try testing.expect(sim.node(1).fg.h_max > 1);
        try testing.expect(sim.last_height_progress >= 128);
        try testing.expect(sim.firstHeightProgressDelay() != null);
        if (!all_nodes) try testing.expect(sim.node(2).fg.F.slot > 0);
        try testing.expectError(error.IncompleteRun, sim.tick());
    }
}

test "checks: finalization premises exclude churn cuts faulty identities and inclusive delay" {
    for (0..4) |case| {
        var options = config;
        options.checks.finalization_bound = 1;
        options.snapshots = false;
        if (case == 3) options.blocks_votes.max = options.protocol.ac.delta;
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        switch (case) {
            0 => {
                try sim.schedule(0, .{ .sleep = 0 });
                try sim.schedule(1, .{ .wake = 0 });
            },
            1 => {
                try sim.schedule(0, .{ .link = .{ .from = 0, .to = 1, .channel = .blocks_votes, .connected = false } });
                try sim.schedule(1, .{ .link = .{ .from = 0, .to = 1, .channel = .blocks_votes, .connected = true } });
            },
            2 => _ = try sim.injectVote(0, 0, 0, &.{ .val_index = 0, .slot = 0, .head = config.protocol.B_gen }, true),
            3 => {},
            else => unreachable,
        }
        try sim.runUntil(16);
        try testing.expect(!sim.finalizationPremises());
        try testing.expectEqual(@as(u32, 0), sim.coverage.finalization.active);
        try testing.expectEqual(@as(u32, 5), sim.coverage.finalization.skipped);
        try testing.expectEqual(Simulator.Verdict.passed, sim.verdict());
    }
}

test "checks: finality compares historical outputs while an honest node sleeps" {
    var options = config;
    options.proposer = 0;
    options.blocks_votes = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    const vote: types.GoldfishVote = .{ .val_index = 0, .slot = 0, .head = config.protocol.B_gen };
    _ = try sim.injectVote(0, 0, 0, &vote, true);
    var A: FG.Block = .{ .root = undefined, .slot = 1, .parent = config.protocol.B_gen, .proposer = 0 };
    A.root = Hash.blockRoot(&A);
    var B = A;
    B.ac_payload.votes = &.{.{ .vote = vote, .authenticated = true }};
    B.root = Hash.blockRoot(&B);
    _ = try sim.injectBlock(17, 0, sim.all(), &A, true);
    _ = try sim.injectBlock(17, 0, sim.all(), &B, true);
    try sim.schedule(21, .{ .sleep = 1 });
    try sim.runUntil(17);
    // Negative control: simulate faulty finalization code without changing shared transitions.
    sim.replicas[1].node.fg.F = A.ref();
    sim.replicas[1].node.fg.J = A.ref();
    try sim.runUntil(21);
    try testing.expectEqual(A.root, sim.tips(1).finalized.root);
    sim.replicas[2].node.fg.F = B.ref();
    sim.replicas[2].node.fg.J = B.ref();
    _ = try sim.injectVote(22, 0, 4, &.{ .val_index = 0, .slot = 1, .head = B.root }, true);
    try testing.expectError(error.FinalityConflict, sim.runUntil(22));
    try testing.expectEqual(@as(u32, 22), sim.now);
    try testing.expect(!sim.node(1).awake);
    try testing.expectEqual(Simulator.Verdict.property_failure, sim.verdict());
}

test "checks: a finalized block that moves back fails that node's own history" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try sim.runUntil(200);
    try testing.expect(sim.tips(1).finalized.slot > 0);
    // Negative control: simulate faulty finalization code without changing shared transitions.
    sim.replicas[1].node.fg.F = .{ .root = config.protocol.B_gen, .slot = 0 };
    try testing.expectError(error.InvariantViolation, sim.runUntil(204));
    try testing.expectEqual(Simulator.Verdict.property_failure, sim.verdict());
}

test "history: one answer per node per instant, and asking changes nothing" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    // Every node's genesis answer is recorded at creation.
    try testing.expectEqual(@as(u32, 4), sim.history.count);
    try sim.runUntil(257);
    var latest: [4]?Simulator.Observation = @splat(null);
    for (sim.history.constSlice()) |entry| {
        if (latest[entry.node]) |previous| {
            try testing.expect(entry.time > previous.time);
            try testing.expect(entry.tips.finalized.slot >= previous.tips.finalized.slot);
        }
        latest[entry.node] = entry;
    }
    for (0..4) |v| try testing.expectEqual(latest[v].?.tips, sim.tips(@intCast(v)));
    // Far fewer entries than one per node per instant: unchanged answers are not recorded.
    try testing.expect(sim.history.count < 4 * 64);

    const node = sim.node(0);
    const before = Hash.nodeDigest(node);
    var scratch: FG.FrameBuffer = undefined;
    const answer = try node.tips(&scratch);
    try testing.expectEqual(sim.tips(0), answer);
    try testing.expectEqual(before, Hash.nodeDigest(node));

    // An asleep node answers nothing, and its last answer stands for the finality check.
    try sim.schedule(258, .{ .sleep = 0 });
    try sim.runUntil(300);
    try testing.expectError(error.Asleep, sim.node(0).tips(&scratch));
    try testing.expectEqual(answer.finalized, sim.tips(0).finalized);
    try testing.expect(sim.tips(1).finalized.slot > answer.finalized.slot);
}

test "checks: warmup comparisons do not count as active confirmation samples" {
    for (1..4) |seed| {
        var options = fuzz_config;
        options.seed = seed;
        options.fuzz.?.process_fault_slots = 0;
        options.fuzz.?.network_fault_slots = 0;
        options.snapshots = false;
        const sim = try Simulator.create(testing.allocator, &options);
        defer sim.destroy();
        if (seed == 3) try testing.expect(sim.confirmationPremises());
        try sim.runUntil(511);
        try testing.expectEqual(@as(u32, 108), sim.coverage.confirmation.active);
        try testing.expectEqual(@as(u32, 0), sim.coverage.confirmation.skipped);
        try testing.expectEqual(@as(u32, 20), sim.coverage.confirmation.warmup);
        try testing.expectEqual(@as(u32, 128), sim.coverage.finality.active);
        try testing.expectEqual(Simulator.Verdict.passed, sim.verdict());
    }
}

test "checks: disabled checks do not accumulate coverage" {
    var options = config;
    options.checks = .{ .finality = false, .confirmation = false };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try testing.expectEqual(Simulator.Verdict.passed, sim.verdict());
    try sim.runUntil(8);
    try testing.expectEqualDeep(Simulator.Coverage{}, sim.coverage);
}

test "checks: a between-tick cut invalidates confirmation after dropping an honest vote" {
    var options = config;
    options.blocks_votes = .{ .min = 2, .max = 2 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    try sim.schedule(21, .{ .link = .{ .from = 0, .to = 1, .channel = .blocks_votes, .connected = false } });
    try sim.schedule(23, .{ .link = .{ .from = 0, .to = 1, .channel = .blocks_votes, .connected = true } });
    try sim.runUntil(24);
    var dropped: u32 = 0;
    for (sim.trace.constSlice()) |entry| {
        if (entry.kind == .drop and entry.time == 22 and entry.peer == 0 and entry.node == 1) dropped += 1;
    }
    try testing.expectEqual(@as(u32, 1), dropped);
    try testing.expectEqual(@as(?u32, 23), sim.last_honest_cut);
    try testing.expect(!sim.confirmationPremises());
    try testing.expectEqual(@as(u32, 0), sim.coverage.confirmation.active);
    try testing.expectEqual(@as(u32, 7), sim.coverage.confirmation.warmup);
    try sim.runUntil(102);
    try testing.expect(!sim.confirmationPremises());
    try sim.runUntil(103);
    try testing.expect(sim.confirmationPremises());
}

test "fuzz: consecutive partitions heal the previous channel before applying the next" {
    var options = config;
    options.seed = 6;
    options.fuzz = .{ .byzantine = 0, .process_fault_slots = 0, .network_fault_slots = 2, .first_slot = 1, .last_slot = 2 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    const first = sim.networkFaultSlot(1).?;
    const second = sim.networkFaultSlot(2).?;
    try testing.expectEqual(@as(u8, 1), sim.plan.channels[first]);
    try testing.expectEqual(@as(u8, 2), sim.plan.channels[second]);
    try sim.runUntil(31);
    try testing.expect(!sim.links[0][3][1]);
    try sim.runUntil(32);
    for (0..4) |from| for (0..4) |to| {
        try testing.expect(sim.links[0][from][to]);
        try testing.expectEqual(sim.plan.groups[second][from] == sim.plan.groups[second][to], sim.links[1][from][to]);
    };
    try sim.runUntil(48);
    for (&sim.links) |*channel| for (channel) |*row| for (row) |connected| try testing.expect(connected);
    try testing.expectEqual(@as(?u32, 48), sim.last_honest_cut);
}

test "simulation: zero-delay relay work exhaustion returns an incomplete run" {
    var options = config;
    options.protocol.n = 16;
    options.snapshots = false;
    options.proposer = 0;
    options.blocks_votes = .{ .min = 0, .max = 0 };
    const sim = try Simulator.create(testing.allocator, &options);
    defer sim.destroy();
    for (1..66) |i| {
        const a: FG.Attestation = .{
            .val_index = 0,
            .h = 1,
            .T = config.protocol.B_gen,
            .tau = false,
            .h_f = 0,
            .T_f = @splat(@intCast(i)),
        };
        _ = try sim.injectAttestation(17, 0, 0, &a, true);
        var B: FG.Block = .{
            .root = undefined,
            .slot = 1,
            .parent = config.protocol.B_gen,
            .proposer = 0,
            .attestations = &.{a},
        };
        B.root = Hash.blockRoot(&B);
        _ = try sim.injectBlock(17, 0, sim.all(), &B, true);
    }
    try testing.expectError(error.DeliveryWorkCapacity, sim.runUntil(17));
    try testing.expect(sim.failed);
    try testing.expect(sim.pending.count > 0 and !sim.pending.full());
    try testing.expectEqual(Simulator.Verdict.incomplete, sim.verdict());
    try testing.expectEqual(error.DeliveryWorkCapacity, sim.failure.?);
    try testing.expectError(error.IncompleteRun, sim.tick());
}

test "checks: replay digest includes progress history coverage and failure classification" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    const initial = sim.digest();
    sim.replicas[0].justified_height_seen += 1;
    try testing.expect(!std.mem.eql(u8, &initial, &sim.digest()));
    sim.replicas[0].justified_height_seen -= 1;
    sim.replicas[0].last_finalization = 1;
    try testing.expect(!std.mem.eql(u8, &initial, &sim.digest()));
    sim.replicas[0].last_finalization = 0;
    sim.coverage.confirmation.skipped = 1;
    try testing.expect(!std.mem.eql(u8, &initial, &sim.digest()));
    sim.coverage = .{};
    try testing.expectEqual(initial, sim.digest());
    sim.failed = true;
    sim.failure = error.FinalityConflict;
    const property_failure = sim.digest();
    sim.failure = error.QueueCapacity;
    try testing.expect(!std.mem.eql(u8, &property_failure, &sim.digest()));
}

test "simulation: a late host catches up its public ticks without stale validator duties" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    // Validator 1 proposes slot 1. Pause its host across slot 1: ticks 16, 20, 24 and 28 are
    // missed; at 30 the first three are a full delta late and run store-only, 28 is two late.
    try sim.schedule(15, .{ .host_pause = .{ .node = 1, .until = 30 } });
    try sim.runUntil(29);
    try testing.expectEqual(@as(u32, 16), sim.node(1).next_tick);
    try testing.expectEqual(@as(u32, 0), sim.node(1).late_ticks);
    var retained: u32 = 0;
    for (sim.pending.constSlice()) |*p| {
        if (p.to == 1 and p.due == null) retained += 1;
    }
    try testing.expect(retained > 0);
    try sim.runUntil(30);
    try testing.expectEqual(@as(u32, 32), sim.node(1).next_tick);
    try testing.expectEqual(@as(u32, 3), sim.node(1).late_ticks);
    try testing.expectEqual(@as(?u32, null), sim.replicas[1].paused_until);
    for (sim.pending.constSlice()) |*p| try testing.expect(p.to != 1 or p.due != null);
    for (sim.packets.constSlice()) |*p| {
        if (p.sender != 1) continue;
        switch (p.body) {
            .block => |i| try testing.expect(sim.blocks.buffer[i].slot != 1),
            .vote => |v| try testing.expect(v.slot != 1),
            .attestation => {},
        }
    }
    try testing.expect(sim.last_honest_churn == 30);
    try sim.runUntil(257);
    try testing.expect(!sim.node(1).stopped);
    try testing.expectEqual(Simulator.Verdict.passed, sim.verdict());
    for (0..4) |v| {
        const node = sim.node(@intCast(v));
        try testing.expect(slot(node, &node.fg.F.root) >= 4);
    }
    try testing.expectError(error.InvalidAction, sim.schedule(300, .{ .host_pause = .{ .node = 1, .until = 300 } }));
}

test "simulation: pausing at an exact public tick skips that tick and the resume runs it late" {
    const sim = try Simulator.create(testing.allocator, &config);
    defer sim.destroy();
    try sim.schedule(16, .{ .host_pause = .{ .node = 2, .until = 17 } });
    try sim.runUntil(17);
    try testing.expectEqual(@as(u32, 20), sim.node(2).next_tick);
    try testing.expectEqual(@as(u32, 0), sim.node(2).late_ticks);
    try testing.expectEqual(@as(u32, 17), sim.node(2).t);
    var paused: u32 = 0;
    var resumed: u32 = 0;
    for (sim.trace.constSlice()) |*entry| {
        if (entry.kind == .host_pause) paused += 1;
        if (entry.kind == .host_resume) resumed += 1;
    }
    try testing.expectEqual(@as(u32, 1), paused);
    try testing.expectEqual(@as(u32, 1), resumed);
}
