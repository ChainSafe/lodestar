//! Roguestar: seeded runs of the Goldilocks simulator, the executable behind `zig build run:roguestar`.
//!
//!   roguestar [seed] [--option[=value] ...]
//!
//! Every simulator knob is an option. A knob not given is drawn from the seed within its swarm range,
//! so a bare seed is a swarm run and pinned options narrow the swarm. Without a seed one is drawn
//! at random and printed. `--sweep N` runs seeds seed .. seed + N - 1 and exits with an error when
//! any seed fails, is incomplete, or has an enabled check without an active sample. `--help` lists
//! the options with their swarm ranges.
const std = @import("std");
const decoupled = @import("decoupled");
const Simulator = decoupled.Simulator;
const limits = decoupled.limits;

const Range = struct { min: u32, max: u32 };
/// A scripted fault on one node, active from `from` until `until`.
const NodeWindow = struct { node: u32, from: u32, until: u32 };
/// Listed nodes in different groups lose both channels in both directions; unlisted nodes keep
/// every link.
const Partition = struct { groups: [Simulator.max_nodes]?u8, from: u32, until: u32 };
const max_scripted = 32;
fn Repeat(comptime T: type) type {
    return struct {
        items: [max_scripted]T = undefined,
        count: u32 = 0,

        fn push(self: *@This(), item: T) !void {
            if (self.count == max_scripted) return error.InvalidArguments;
            self.items[self.count] = item;
            self.count += 1;
        }
        fn slice(self: *const @This()) []const T {
            return self.items[0..self.count];
        }
    };
}

/// Pinned knobs. Null draws from the seed. An option is its field name with `-` for `_`.
const CLIArgs = struct {
    // Run
    seed: ?u64 = null,
    slots: ?u32 = null,
    sweep: u32 = 0,
    trace: bool = false,
    probe: bool = false,
    snapshots: ?bool = null,
    help: bool = false,
    // Protocol (Node.Config)
    n: ?u32 = null,
    delta: ?u32 = null,
    r: ?u32 = null,
    k: ?u32 = null,
    delta_f: ?u32 = null,
    k_w: ?u32 = null,
    delta_t: ?u32 = null,
    // Network
    delay: ?Range = null,
    attestation_delay: ?Range = null,
    // Seeded faults (Simulator.Fuzz)
    byzantine: ?u32 = null,
    twins: ?u32 = null,
    process: ?u32 = null,
    network: ?u32 = null,
    fault_slots: ?Range = null,
    drop_rate: ?u32 = null,
    late_rate: ?u32 = null,
    mutation_rate: ?u32 = null,
    late_max: ?u32 = null,
    // Scripted faults, repeatable
    sleep: Repeat(NodeWindow) = .{},
    crash: Repeat(NodeWindow) = .{},
    pause: Repeat(NodeWindow) = .{},
    storage_fail: Repeat(NodeWindow) = .{},
    partition: Repeat(Partition) = .{},
    // Checks
    height_progress_bound: ?u32 = null,
    finalization_bound: ?u32 = null,
    no_finality: bool = false,
    no_confirmation: bool = false,
    no_block_requests: bool = false,
};

const help_text =
    \\roguestar [seed] [--option[=value] ...]
    \\
    \\A knob not given is drawn from the seed within its swarm range. The swarm draws faults so
    \\the confirmation premise can hold; pinned options may not. Times are clock instants; a slot
    \\is 4*delta instants. Repeatable options take NODE@FROM-UNTIL.
    \\
    \\Run
    \\  seed                      positional; random when absent (printed)
    \\  --slots N                 run length in slots            swarm 24..48
    \\  --sweep N                 run N seeds from seed, snapshots off
    \\  --trace                   print the event trace
    \\  --probe                   print each node's view at every attestation tick
    \\  --snapshots BOOL          hash every node after every event (default: not a sweep)
    \\Protocol
    \\  --n N                     validators                      swarm 4..10
    \\  --delta D                 delivery bound, instants        swarm 2, 4, 8
    \\  --r R                     slots per FG round              swarm min..min+1
    \\  --k K                     slow-lock window, slots         swarm 2..4
    \\  --delta-f D               attestation delivery bound      swarm delta..2*delta
    \\  --k-w W                   pending finality window         swarm 2..4
    \\  --delta-t T               timeout delay, slots            swarm 0..3
    \\Network
    \\  --delay MIN-MAX           block and vote latency          swarm 0..0-delta
    \\  --attestation-delay MIN-MAX                               swarm 0..0-delta_f
    \\  --no-block-requests       the transport loses every request for a missing parent block
    \\Seeded faults
    \\  --byzantine F             Byzantine validators            swarm 0..(n-1)/3
    \\  --twins T                 extra replicas sharing a Byzantine identity   swarm 0..1 with Byzantine
    \\  --process P               process-fault slots             swarm 1..4 with Byzantine, else 0
    \\  --network Q               partition slots                 swarm 0..4
    \\  --fault-slots A-B         slot span for both              swarm 1-(slots-n-k-3)
    \\  --drop-rate, --late-rate, --mutation-rate   per mille      100, 200, 500
    \\  --late-max D              greatest late delay, instants   max(delta+1, 32)
    \\Scripted faults
    \\  --sleep NODE@FROM-UNTIL          no ticks or reception; memory kept, AC restarts on wake
    \\  --crash NODE@FROM-UNTIL          as sleep, but memory is lost and rebuilt from storage
    \\  --pause NODE@FROM-UNTIL          late host, catches up on resume
    \\  --storage-fail NODE@FROM-UNTIL   durable writes fail
    \\  --partition 0,1:2,3@FROM-UNTIL   cut listed groups from each other
    \\Checks
    \\  --height-progress-bound B   instants; default 4 rounds when faults are planned
    \\  --finalization-bound B      instants; default off
    \\  --no-finality, --no-confirmation
    \\
;

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const cli = parse(args) catch |err| {
        std.debug.print("{s}\n{s}", .{ @errorName(err), help_text });
        return err;
    };
    if (cli.help) {
        std.debug.print("{s}", .{help_text});
        return;
    }
    const seed = cli.seed orelse random: {
        var bytes: [8]u8 = undefined;
        init.io.random(&bytes);
        break :random std.mem.readInt(u64, &bytes, .little);
    };
    if (cli.sweep != 0) return runSweep(init.gpa, seed, &cli);
    const resolved = resolve(seed, &cli) catch |err| {
        std.debug.print("{s}: an option is out of range for this seed; see --help\n", .{@errorName(err)});
        return err;
    };
    printResolved(&resolved, seed);
    const sim = try runWith(init.gpa, &resolved, &cli);
    defer sim.destroy();
    report(sim, seed);
    if (cli.trace) printTrace(sim);
    switch (sim.verdict()) {
        .passed => {},
        .property_failure => return error.PropertyFailed,
        .incomplete => return error.IncompleteRun,
    }
}

fn runSweep(allocator: std.mem.Allocator, first_seed: u64, cli: *const CLIArgs) !void {
    var counts: [3]u64 = @splat(0);
    var first_failure: ?u64 = null;
    var progressed: u64 = 0;
    var progress_delay_sum: u64 = 0;
    var progress_delay_max: u32 = 0;
    for (0..cli.sweep) |offset| {
        const seed = first_seed + offset;
        const resolved = try resolve(seed, cli);
        const sim = try runWith(allocator, &resolved, cli);
        defer sim.destroy();
        const delay = sim.firstHeightProgressDelay();
        if (delay) |d| {
            progressed += 1;
            progress_delay_sum += d;
            progress_delay_max = @max(progress_delay_max, d);
        }
        const verdict = sim.verdict();
        counts[@intFromEnum(verdict)] += 1;
        if (sim.failed and first_failure == null) first_failure = seed;
        std.debug.print("seed={d} result={s} error={s} time={d} first_height_progress_delay={?d} digest={s}\n", .{
            seed,
            @tagName(verdict),
            if (sim.failure) |err| @errorName(err) else "none",
            sim.now,
            delay,
            std.fmt.bytesToHex(sim.digest(), .lower),
        });
        printResolved(&resolved, seed);
        printCoverage(sim);
    }
    const mean: u64 = if (progressed > 0) progress_delay_sum / progressed else 0;
    const passed = counts[@intFromEnum(Simulator.Verdict.passed)];
    const failures = counts[@intFromEnum(Simulator.Verdict.property_failure)];
    const incomplete = counts[@intFromEnum(Simulator.Verdict.incomplete)];
    std.debug.print(
        "sweep seeds={d} from={d} passed={d} property_failures={d} incomplete={d} " ++
            "first_failure={?d} height_progressed={d} first_height_progress_delay_mean={d} " ++
            "first_height_progress_delay_max={d}\n",
        .{
            cli.sweep,     first_seed, passed, failures,           incomplete,
            first_failure, progressed, mean,   progress_delay_max,
        },
    );
    if (failures + incomplete > 0) return error.SweepFailed;
}

fn parse(args: []const []const u8) !CLIArgs {
    var cli: CLIArgs = .{};
    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (!std.mem.startsWith(u8, arg, "--")) {
            if (cli.seed != null) return error.InvalidArguments;
            cli.seed = try std.fmt.parseInt(u64, arg, 0);
            continue;
        }
        const body = arg[2..];
        const separator = std.mem.indexOfScalar(u8, body, '=');
        const name = if (separator) |s| body[0..s] else body;
        var value: ?[]const u8 = if (separator) |s| body[s + 1 ..] else null;
        var matched = false;
        inline for (std.meta.fields(CLIArgs)) |field| {
            if (!matched and optionMatches(field.name, name)) {
                matched = true;
                if (field.type == bool) {
                    if (value != null) return error.InvalidArguments;
                    @field(cli, field.name) = true;
                } else {
                    if (value == null) {
                        if (i + 1 >= args.len) return error.InvalidArguments;
                        i += 1;
                        value = args[i];
                    }
                    try parseInto(field.type, &@field(cli, field.name), value.?);
                }
            }
        }
        if (!matched) return error.InvalidArguments;
    }
    if (cli.trace and cli.sweep != 0) return error.InvalidArguments;
    if (cli.probe and cli.sweep != 0) return error.InvalidArguments;
    return cli;
}

fn optionMatches(comptime field: []const u8, name: []const u8) bool {
    if (field.len != name.len) return false;
    for (field, name) |expected, actual| {
        const wanted: u8 = if (expected == '_') '-' else expected;
        if (wanted != actual) return false;
    }
    return true;
}

fn parseInto(comptime T: type, destination: *T, text: []const u8) !void {
    switch (T) {
        u32 => destination.* = try std.fmt.parseInt(u32, text, 0),
        ?u32 => destination.* = try std.fmt.parseInt(u32, text, 0),
        ?u64 => destination.* = try std.fmt.parseInt(u64, text, 0),
        ?bool => {
            if (std.mem.eql(u8, text, "true")) {
                destination.* = true;
            } else if (std.mem.eql(u8, text, "false")) {
                destination.* = false;
            } else return error.InvalidArguments;
        },
        ?Range => destination.* = try parseRange(text),
        Repeat(NodeWindow) => try destination.push(try parseNodeWindow(text)),
        Repeat(Partition) => try destination.push(try parsePartition(text)),
        else => @compileError("unsupported option type " ++ @typeName(T)),
    }
}

fn parseRange(text: []const u8) !Range {
    const dash = std.mem.indexOfScalar(u8, text, '-') orelse return error.InvalidArguments;
    const range: Range = .{
        .min = try std.fmt.parseInt(u32, text[0..dash], 0),
        .max = try std.fmt.parseInt(u32, text[dash + 1 ..], 0),
    };
    if (range.min > range.max) return error.InvalidArguments;
    return range;
}

fn parseNodeWindow(text: []const u8) !NodeWindow {
    const at = std.mem.indexOfScalar(u8, text, '@') orelse return error.InvalidArguments;
    const window = try parseRange(text[at + 1 ..]);
    if (window.min == window.max) return error.InvalidArguments;
    return .{ .node = try std.fmt.parseInt(u32, text[0..at], 0), .from = window.min, .until = window.max };
}

fn parsePartition(text: []const u8) !Partition {
    const at = std.mem.indexOfScalar(u8, text, '@') orelse return error.InvalidArguments;
    const window = try parseRange(text[at + 1 ..]);
    if (window.min == window.max) return error.InvalidArguments;
    var partition: Partition = .{ .groups = @splat(null), .from = window.min, .until = window.max };
    var groups = std.mem.splitScalar(u8, text[0..at], ':');
    var group: u8 = 0;
    while (groups.next()) |members| : (group += 1) {
        if (group == Simulator.max_nodes) return error.InvalidArguments;
        var nodes = std.mem.splitScalar(u8, members, ',');
        while (nodes.next()) |node_text| {
            const node = try std.fmt.parseInt(u32, node_text, 0);
            if (node >= Simulator.max_nodes or partition.groups[node] != null) return error.InvalidArguments;
            partition.groups[node] = group;
        }
    }
    if (group < 2) return error.InvalidArguments;
    return partition;
}

/// A knob's value and whether the seed or the command line chose it.
const Resolved = struct {
    config: Simulator.Config,
    slots: u32,
    end: u32,
};

/// SplitMix64 over a stream separate from the simulator's own, so pinning a knob changes nothing
/// else that the seed drew.
const Swarm = struct {
    state: u64,

    fn next(self: *Swarm) u64 {
        self.state +%= 0x9e3779b97f4a7c15;
        var z = self.state;
        z = (z ^ (z >> 30)) *% 0xbf58476d1ce4e5b9;
        z = (z ^ (z >> 27)) *% 0x94d049bb133111eb;
        return z ^ (z >> 31);
    }

    /// Always consumes one draw, so a pinned knob does not shift the others.
    fn draw(self: *Swarm, pinned: ?u32, low: u32, high: u32) u32 {
        std.debug.assert(low <= high);
        const drawn = low + @as(u32, @intCast(self.next() % (@as(u64, high) - low + 1)));
        return pinned orelse drawn;
    }
};

fn resolve(seed: u64, cli: *const CLIArgs) !Resolved {
    var swarm: Swarm = .{ .state = seed ^ 0x526f677565737461 };
    const delta = cli.delta orelse @as(u32, 2) << @intCast(swarm.draw(null, 0, 2));
    if (delta == 0) return error.InvalidArguments;
    const slots_max = @min(limits.max_slots, Simulator.max_time / (4 * delta));
    if (slots_max < 2) return error.InvalidArguments;
    const slots = swarm.draw(cli.slots, @min(24, slots_max), @min(48, slots_max));
    if (slots < 2 or slots > slots_max) return error.InvalidArguments;
    const n = swarm.draw(cli.n, 4, 10);
    if (n == 0 or n > Simulator.max_nodes or n > limits.max_validators) return error.InvalidArguments;
    const delta_f = swarm.draw(cli.delta_f, delta, 2 * delta);
    if (delta_f < delta) return error.InvalidArguments;
    const rounds_min: u32 = @max(2, (6 * delta + delta_f + 4 * delta - 1) / (4 * delta));
    const rounds = swarm.draw(cli.r, rounds_min, rounds_min + 1);
    const k = swarm.draw(cli.k, 2, 4);
    const k_w = swarm.draw(cli.k_w, 2, 4);
    const delta_t = swarm.draw(cli.delta_t, 0, 3);
    const delay: Range = cli.delay orelse .{ .min = 0, .max = swarm.draw(null, 0, delta) };
    const attestation_delay: Range = cli.attestation_delay orelse .{ .min = 0, .max = swarm.draw(null, 0, delta_f) };

    // Twins reuse a Byzantine identity only, so the faulty count stays what the premises count.
    const byzantine = swarm.draw(cli.byzantine, 0, (n - 1) / 3);
    if (byzantine >= n) return error.InvalidArguments;
    const twins = swarm.draw(cli.twins, 0, if (byzantine > 0 and n < Simulator.max_nodes) 1 else 0);
    if (n + twins > Simulator.max_nodes) return error.InvalidArguments;
    const process = swarm.draw(cli.process, if (byzantine > 0) 1 else 0, if (byzantine > 0) 4 else 0);
    const network = swarm.draw(cli.network, 0, 4);
    // Leave a fault-free suffix longer than the confirmation window so the check samples at the end.
    const fault_slots: Range = cli.fault_slots orelse .{ .min = 1, .max = @max(1, slots -| (k + 3)) };
    const planned = byzantine + process + network > 0;
    const fuzz: ?Simulator.Fuzz = if (planned) .{
        .byzantine = byzantine,
        .process_fault_slots = process,
        .network_fault_slots = network,
        .first_slot = fault_slots.min,
        .last_slot = fault_slots.max,
        .drop_rate = cli.drop_rate orelse 100,
        .late_rate = cli.late_rate orelse 200,
        .mutation_rate = cli.mutation_rate orelse 500,
        .late_max = cli.late_max orelse @max(delta + 1, 32),
    } else null;

    const end = 4 * delta * slots - 1;
    const resolved: Resolved = .{
        .slots = slots,
        .end = end,
        .config = .{
            .protocol = .{
                .B_gen = @splat(0),
                .n = n,
                .val_index = 0,
                .ac = .{ .delta = delta, .R = rounds, .k = k },
                .fg = .{ .delta_f = delta_f, .K_W = k_w, .delta_t = delta_t },
            },
            .seed = seed,
            .blocks_votes = .{ .min = delay.min, .max = delay.max },
            .attestations = .{ .min = attestation_delay.min, .max = attestation_delay.max },
            .checks = .{
                .finality = !cli.no_finality,
                .confirmation = !cli.no_confirmation,
                .height_progress_bound = cli.height_progress_bound orelse
                    (if (planned) 4 * (4 * delta * rounds) else null),
                .finalization_bound = cli.finalization_bound,
            },
            .fuzz = fuzz,
            .snapshots = cli.snapshots orelse (cli.sweep == 0),
            .twins = twins,
            .block_requests = !cli.no_block_requests,
        },
    };
    const nodes = n + twins;
    for (cli.sleep.slice()) |window| try checkWindow(window, nodes, end);
    for (cli.crash.slice()) |window| try checkWindow(window, nodes, end);
    for (cli.pause.slice()) |window| try checkWindow(window, nodes, end);
    for (cli.storage_fail.slice()) |window| try checkWindow(window, nodes, end);
    for (cli.partition.slice()) |partition| {
        if (partition.from >= partition.until or partition.until > end) return error.InvalidArguments;
        for (partition.groups[nodes..]) |group| if (group != null) return error.InvalidArguments;
    }
    return resolved;
}

fn checkWindow(window: NodeWindow, nodes: u32, end: u32) !void {
    if (window.node >= nodes or window.from >= window.until or window.until > end) return error.InvalidArguments;
}

fn printResolved(resolved: *const Resolved, seed: u64) void {
    const c = &resolved.config;
    const p = &c.protocol;
    std.debug.print(
        "options seed={d} slots={d} end={d} n={d} delta={d} R={d} k={d} delta_f={d} K_W={d} delta_t={d} " ++
            "delay={d}-{d} attestation_delay={d}-{d} twins={d} snapshots={} block_requests={}\n",
        .{
            seed,               resolved.slots,     resolved.end,       p.n,
            p.ac.delta,         p.ac.R,             p.ac.k,             p.fg.delta_f,
            p.fg.K_W,           p.fg.delta_t,       c.blocks_votes.min, c.blocks_votes.max,
            c.attestations.min, c.attestations.max, c.twins,            c.snapshots,
            c.block_requests,
        },
    );
    if (c.fuzz) |fuzz| {
        std.debug.print(
            "  faults byzantine={d} process={d} network={d} fault_slots={d}-{d} drop_rate={d} late_rate={d} mutation_rate={d} late_max={d}\n",
            .{
                fuzz.byzantine, fuzz.process_fault_slots, fuzz.network_fault_slots, fuzz.first_slot,
                fuzz.last_slot, fuzz.drop_rate,           fuzz.late_rate,           fuzz.mutation_rate,
                fuzz.late_max,
            },
        );
    } else {
        std.debug.print("  faults none\n", .{});
    }
    std.debug.print("  checks finality={} confirmation={} height_progress_bound={?d} finalization_bound={?d}\n", .{
        c.checks.finality, c.checks.confirmation, c.checks.height_progress_bound, c.checks.finalization_bound,
    });
}

/// Run one seed to its end. A failed run returns normally with `failed` set, so a sweep can
/// continue; the caller decides how to report it.
fn runWith(allocator: std.mem.Allocator, resolved: *const Resolved, cli: *const CLIArgs) !*Simulator {
    const sim = try Simulator.create(allocator, &resolved.config);
    errdefer sim.destroy();
    try script(sim, cli, resolved.config.protocol.n + resolved.config.twins);
    if (cli.probe) {
        probeUntil(sim, resolved.end) catch |err| {
            sim.failed = true;
            if (sim.failure == null) sim.failure = err;
        };
    } else {
        sim.runUntil(resolved.end) catch |err| {
            sim.failed = true;
            if (sim.failure == null) sim.failure = err;
        };
    }
    return sim;
}

fn script(sim: *Simulator, cli: *const CLIArgs, nodes: u32) !void {
    for (cli.sleep.slice()) |window| {
        try sim.schedule(window.from, .{ .sleep = window.node });
        try sim.schedule(window.until, .{ .wake = window.node });
    }
    for (cli.crash.slice()) |window| {
        try sim.schedule(window.from, .{ .crash = window.node });
        try sim.schedule(window.until, .{ .wake = window.node });
    }
    for (cli.pause.slice()) |window| {
        try sim.schedule(window.from, .{ .host_pause = .{ .node = window.node, .until = window.until } });
    }
    for (cli.storage_fail.slice()) |window| {
        try sim.schedule(window.from, .{ .storage_failure = .{ .node = window.node, .enabled = true } });
        try sim.schedule(window.until, .{ .storage_failure = .{ .node = window.node, .enabled = false } });
    }
    for (cli.partition.slice()) |partition| {
        for (0..nodes) |from| for (0..nodes) |to| {
            const a = partition.groups[from] orelse continue;
            const b = partition.groups[to] orelse continue;
            if (a == b) continue;
            for ([_]Simulator.Channel{ .blocks_votes, .attestations }) |channel| {
                var link: Simulator.Link = .{
                    .from = @intCast(from),
                    .to = @intCast(to),
                    .channel = channel,
                    .connected = false,
                };
                try sim.schedule(partition.from, .{ .link = link });
                link.connected = true;
                try sim.schedule(partition.until, .{ .link = link });
            }
        };
    }
}

/// Like `runUntil`, but after every attestation tick print what each node's FG attestation saw:
/// the deepest viable fast-confirmed block, its chain state's height and T_h, and the head.
/// The probe reads state after that instant's deliveries, so it can differ from the node's own
/// view at its tick when a delivery landed at the same instant.
fn countTrue(flags: []const bool) u32 {
    var total: u32 = 0;
    for (flags) |flag| total += @intFromBool(flag);
    return total;
}

fn probeUntil(sim: *Simulator, end: u32) !void {
    const delta = sim.config.protocol.ac.delta;
    const first = 6 * delta;
    const period = 4 * delta * sim.config.protocol.ac.R;
    while (sim.next_time <= end) {
        try sim.tick();
        const t = sim.now;
        if (t < first or (t - first) % period != 0) continue;
        std.debug.print("probe t={d} slot={d}\n", .{ t, t / (4 * delta) });
        for (sim.replicas, 0..) |*replica, index| {
            const node = &replica.node;
            const fg = &node.fg;
            const Phi = try fg.toAC(&node.frame_buffer);
            const pair = try node.ac.toFG(&Phi, t);
            const head_index = fg.find(&pair.head) orelse continue;
            const head_state = replica.state_source.state(&pair.head) orelse continue;
            std.debug.print("  node={d} head_slot={d} head_h={d} head_h_j={d} h_max={d}", .{
                index, fg.T.buffer[head_index].slot, head_state.h, head_state.h_j, fg.h_max,
            });
            if (pair.fg_confirmed) |root| {
                if (fg.find(&root)) |i| {
                    const state = replica.state_source.state(&root).?;
                    const T_index = fg.find(&state.T_h.root);
                    std.debug.print(" confirmed_slot={d} confirmed_h={d} T_h_slot={?d} progress={d} target_part={d}", .{
                        fg.T.buffer[i].slot,        state.h,                                if (T_index) |x| fg.T.buffer[x].slot else null,
                        countTrue(&state.progress), countTrue(&state.target_participation),
                    });
                }
            } else {
                std.debug.print(" confirmed=none", .{});
            }
            std.debug.print(" fast=", .{});
            for (node.ac.fast_confirmed.constSlice()) |*root| {
                if (fg.find(root)) |i| std.debug.print("{d},", .{fg.T.buffer[i].slot});
            }
            // The slot whose confirmation update ran at this instant, and its vote pool:
            // validator:head_slot@resolution_time, with ! when the vote does not count as support.
            const s = t / (4 * delta) - 1;
            const cutoff = 4 * delta * s + 2 * delta;
            std.debug.print(" pool[{d}]=", .{s});
            for (node.ac.pools[s].constSlice()) |*entry| {
                const head_slot: ?u32 = if (fg.find(&entry.vote.head)) |i| fg.T.buffer[i].slot else null;
                const resolved = node.ac.resolutionTime(&Phi, s, &entry.vote);
                const supported = if (resolved) |time| time < cutoff else false;
                std.debug.print("{d}:{?d}@{?d}{s} ", .{
                    entry.vote.val_index, head_slot, resolved, if (supported) "" else "!",
                });
            }
            std.debug.print("\n", .{});
        }
    }
}

fn printCoverage(sim: *const Simulator) void {
    const checks = sim.config.checks;
    const enabled = [_]bool{ checks.finality, checks.confirmation, checks.height_progress_bound != null, checks.finalization_bound != null };
    inline for (std.meta.fields(Simulator.Coverage), 0..) |field, i| {
        const coverage = @field(sim.coverage, field.name);
        std.debug.print("  check={s} enabled={} active={d} skipped={d} warmup={d}\n", .{
            field.name, enabled[i], coverage.active, coverage.skipped, coverage.warmup,
        });
    }
}

fn report(sim: *const Simulator, seed: u64) void {
    std.debug.print("seed={d} result={s} error={s} time={d} records={d} digest={s}\n", .{
        seed,
        @tagName(sim.verdict()),
        if (sim.failure) |err| @errorName(err) else "none",
        sim.now,
        sim.trace.count,
        std.fmt.bytesToHex(sim.digest(), .lower),
    });
    printCoverage(sim);
    if (sim.config.fuzz != null) {
        std.debug.print("byzantine=0x{x} process_slots={any} network_slots={any}\n", .{
            sim.plan.byzantine, sim.plan.process_slots, sim.plan.network_slots,
        });
    }
    std.debug.print("nodes={d} validators={d} faulty=0x{x} first_height_progress_delay={?d}\n", .{
        sim.replicas.len, sim.config.protocol.n, sim.faulty, sim.firstHeightProgressDelay(),
    });
    for (sim.replicas, 0..) |*replica, v| {
        const node = &replica.node;
        const fg = &node.fg;
        const F = fg.T.buffer[fg.find(&fg.F.root).?].slot;
        const C = fg.T.buffer[fg.find(&node.ac.latest_confirmed).?].slot;
        std.debug.print("node={d} validator={d} finalized_slot={d} last_finalization={d} confirmation_record_slot={d}\n", .{
            v, replica.validator, F, replica.last_finalization, C,
        });
        // Finality-gadget detail: the caches, the head chain's state, and the signing record at
        // the two heights a validator can vote at.
        var buffer: @TypeOf(node.fg).FrameBuffer = undefined;
        const Phi = fg.toAC(&buffer) catch continue;
        const head = node.ac.head(&Phi, sim.now) catch continue;
        const head_state = replica.state_source.state(&head) orelse continue;
        const Lambda = &node.Lambda;
        std.debug.print(
            "  h_max={d} h_j={d} contest={} head: h={d} h_j={d} h_F={d} T_h_slot={d} pending={d} sent={d}\n",
            .{
                fg.h_max,            fg.h_j,
                fg.fgContest(),      head_state.h,
                head_state.h_j,      head_state.h_F,
                head_state.T_h.slot, head_state.pending_finality.count,
                Lambda.sent.count,
            },
        );
        // This node's roots, and how much of node 0's head chain it holds.
        const reference = &sim.replicas[0].node;
        var ref_buffer: @TypeOf(node.fg).FrameBuffer = undefined;
        const ref_Phi = reference.fg.toAC(&ref_buffer) catch continue;
        var cursor = reference.ac.head(&ref_Phi, sim.now) catch continue;
        var missing: u32 = 0;
        var first_missing_slot: ?u32 = null;
        var walked: u32 = 0;
        while (walked < 256) : (walked += 1) {
            const ref_index = reference.fg.find(&cursor) orelse break;
            if (fg.find(&cursor) == null) {
                missing += 1;
                first_missing_slot = reference.fg.T.buffer[ref_index].slot;
            }
            if (ref_index == 0) break;
            cursor = reference.fg.T.buffer[ref_index].parent;
        }
        const fc_root = fg.getFCRoot();
        std.debug.print(
            "  blocks={d} J_slot={d} fc_root_slot={d} head_slot={d} missing_from_node0_chain={d} lowest_missing_slot={?d}\n",
            .{
                fg.T.count,
                fg.J.slot,
                fc_root.slot,
                fg.T.buffer[fg.find(&head).?].slot,
                missing,
                first_missing_slot,
            },
        );
        var h: u32 = if (fg.h_max > 1) fg.h_max - 1 else 1;
        while (h <= fg.h_max) : (h += 1) {
            std.debug.print("  record h={d} target={} timeout={} lock={}\n", .{
                h, Lambda.target[h] != null, Lambda.timeout[h], Lambda.lock[h] != null,
            });
        }
        // Every attestation this validator sent, with its target named by slot when held.
        for (Lambda.sent.constSlice()) |*a| {
            const target_slot: ?u32 = if (fg.find(&a.T)) |i| fg.T.buffer[i].slot else null;
            std.debug.print("  sent h={d} T_slot={?d} tau={} h_f={?d}\n", .{ a.h, target_slot, a.tau, a.h_f });
        }
        // Saved confirmations of the last eight slots, by slot of the confirmed block.
        const current = sim.now / (4 * sim.config.protocol.ac.delta);
        var s: u32 = if (current >= 8) current - 8 else 0;
        std.debug.print("  saved_confirmations:", .{});
        while (s < current) : (s += 1) {
            if (node.ac.saved_confirmation[s]) |root| {
                const slot: ?u32 = if (fg.find(&root)) |i| fg.T.buffer[i].slot else null;
                std.debug.print(" {d}:{?d}", .{ s, slot });
            } else {
                std.debug.print(" {d}:-", .{s});
            }
        }
        std.debug.print(" locks={d} fast={d}\n", .{ node.ac.locks.count, node.ac.fast_confirmed.count });
    }
}

fn printTrace(sim: *const Simulator) void {
    for (sim.trace.constSlice()) |*entry| {
        std.debug.print("t={d} {s} node={d} peer={d} packet={d} value={d} state={s}\n", .{
            entry.time,
            @tagName(entry.kind),
            entry.node,
            entry.peer,
            entry.packet,
            entry.value,
            std.fmt.bytesToHex(entry.state, .lower),
        });
    }
}
