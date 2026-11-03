const std = @import("std");
const t = @import("types.zig");
const custody = @import("custody.zig");
const reputation = @import("reputation.zig");
const lists = @import("../index_list.zig");
const enr = @import("enr.zig");
const identity_index = @import("identity_index.zig");
const dial_history = @import("dial_history.zig");
const remembered = @import("remembered.zig");
const Now = @import("../types.zig").Now;
const assert = std.debug.assert;
const identify_mod = @import("../identify/root.zig");
const limits = @import("../quic/limits.zig");
const preset = @import("preset");
const logging = @import("../logging.zig");
const client = @import("client.zig");
const goodbye = @import("goodbye.zig");

pub const Catalog = struct {
    pub const replacement_grace_ms: u64 = 600_000;
    pub const hint_freshness_ms: u64 = 300_000;
    pub const DialState = struct {
        automatic: bool = false,
        selected: bool = true,
        priority: u2 = 0,
        hints: ?enr.Hints = null,
        hints_at_ms: u64 = 0,
        addresses: [2]t.Address = undefined,
        address_count: u8 = 0,
        address_index: u8 = 0,
        manual_until_ms: u64 = 0,
        eligible_at_ms: u64 = 0,
        replacement_after_ms: u64 = 0,
        failures: u8 = 0,
        origin: remembered.Origin = .fresh,

        pub fn deferUntil(self: *DialState, eligible_at_ms: u64) void {
            self.eligible_at_ms = @max(self.eligible_at_ms, eligible_at_ms);
        }

        pub fn dialFailed(self: *DialState, now_ms: u64, jitter: u16) void {
            self.backoff(.dial, now_ms, jitter);
        }

        pub fn connectionClosed(self: *DialState, now_ms: u64, lifetime_ms: u64, jitter: u16) void {
            if (lifetime_ms >= 300_000) self.failures = 0;
            self.backoff(.connection, now_ms, jitter);
        }

        fn backoff(self: *DialState, stage: enum { dial, connection }, now_ms: u64, jitter: u16) void {
            assert(jitter <= 1_000);
            self.failures = @min(self.failures +| 1, 7);
            const base: u64 = if (stage == .dial) 1_000 else 5_000;
            const ceiling: u64 = if (stage == .dial) 60_000 else 300_000;
            const delay = @min(base << @intCast(self.failures - 1), ceiling);
            // Dial jitter fits inside its ceiling; established-connection jitter follows it.
            const jittered = if (stage == .dial) @min(delay + jitter, ceiling) else delay + jitter;
            self.deferUntil(now_ms +| jittered);
        }
    };
    pub const Row = struct {
        free_link: lists.Link = .{},
        established_slot: ?u16 = null,
        dial: DialState = .{},
        attempt: ?u8 = null,
        identify: ?identify_mod.Metadata = null,
        custody_work: ?custody.SamplingDerivation = null,
        custody_context: ?t.ForkContext = null,
        generation: u64 = 0,
        occupied: bool = false,
        identity: t.PeerId = undefined,
        node_id: ?[32]u8 = null,
        connection: ?t.Handle = null,
        closing_reason: ?t.DisconnectReason = null,
        direction: t.Direction = .inbound,
        endpoint: t.Address = .unspecified,
        /// The endpoint the connection was dialed to, kept after its attempt retires; null for an
        /// inbound connection.
        dialed: ?t.Address = null,
        /// Where an automatic dial's candidate came from, until the connection is counted as kept.
        origin: ?remembered.Origin = null,
        status: ?t.Status = null,
        metadata: ?t.Metadata = null,
        status_at_ms: u64 = 0,
        metadata_at_ms: u64 = 0,
        connected_at_ms: u64 = 0,
        direct: bool = false,
        reputation: reputation.State = .{},
        published: bool = false,
        pending_update: bool = false,
        pending_close: ?struct { connection: t.Handle, reason: t.DisconnectReason } = null,
    };
    pub const Admission = union(enum) {
        admitted: struct { peer: t.PeerRef, displaced: ?t.Handle = null, fresh: bool },
        duplicate,
        pending,
        banned,
        cooldown,
        capacity,
    };
    pub const AdmissionOptions = struct {
        direction: t.Direction,
        endpoint: t.Address,
        now_ms: u64,
        outbound_reserved: u16 = 0,
        pending_dials: u16 = 0,
        /// The authenticated identity owns a live selected dial commitment.
        selected_dial: bool = false,
        /// Derived from the same identity in a verified discovery record.
        node_id: ?[32]u8 = null,
    };
    pub const Options = struct {
        capacity: u16 = 512,
        outbound_reserve: u16 = 32,
        target_peers: u16 = 64,
        max_peers: u16 = 96,
        min_outbound: u16 = 16,
        /// Concurrent inbound connections per IPv4 address or IPv6 /64, including closing peers.
        inbound_per_source_max: u16 = 16,

        pub fn validate(self: Options) error{InvalidOptions}!void {
            if (self.capacity == 0 or self.capacity > 4096 or
                self.outbound_reserve >= self.capacity or self.max_peers == 0 or
                self.max_peers > self.capacity or
                self.max_peers > 256 or self.target_peers > self.max_peers or
                self.min_outbound > self.target_peers or
                self.inbound_per_source_max == 0 or self.inbound_per_source_max > 256) return error.InvalidOptions;
        }
    };

    rows: []Row,
    by_identity: identity_index.Index,
    by_connection: []?u16,
    options: Options,
    intent_capacity: u16,
    intent_count: u16 = 0,
    intents: std.DynamicBitSetUnmanaged,
    intent_masks: []usize,
    history: dial_history.History,
    remembered: remembered.Memory,
    established: []?u16,
    free: lists.List = .{},
    connected_count: u16 = 0,
    direct_count: u16 = 0,
    intents_dirty: bool = true,
    /// Rejections recorded against identities, by kind.
    rejections: [@typeInfo(t.Rejection).@"enum".fields.len]u64 = @splat(0),
    random: std.Random.DefaultPrng,
    candidate_custody_cursor: usize = 0,
    selection_dirty: bool = true,
    event_cursor: usize = 0,
    custody_cursor: usize = 0,
    /// Rows with a pending close or update; pollEvents visits only these.
    events: std.DynamicBitSetUnmanaged,
    event_masks: []usize,
    event_count: u16 = 0,
    /// Snapshots report reputation decayed to the last owner clock.
    clock_ms: u64 = 0,
    dial_schedule_dirty: bool = true,

    pub fn init(a: std.mem.Allocator, options: Options, connections_max: u16, seed: u64) !Catalog {
        return initWithIntents(a, options, 0, connections_max, seed);
    }

    pub fn initWithIntents(a: std.mem.Allocator, options: Options, intent_capacity: u16, connections_max: u16, seed: u64) !Catalog {
        try options.validate();
        if (intent_capacity > 4096) return error.InvalidOptions;
        if (connections_max == 0 or connections_max > limits.connections_max_ceiling) return error.InvalidOptions;
        const rows = try a.alloc(Row, @as(usize, options.capacity) + intent_capacity);
        errdefer a.free(rows);

        const slots = try a.alloc(u16, identity_index.capacity(rows.len));
        errdefer a.free(slots);

        const connections = try a.alloc(?u16, connections_max);
        errdefer a.free(connections);

        const established = try a.alloc(?u16, options.capacity);
        errdefer a.free(established);
        const intent_masks = try a.alloc(usize, try std.math.divCeil(usize, rows.len, @bitSizeOf(usize)));
        errdefer a.free(intent_masks);
        const history = try a.alloc(dial_history.Entry, dial_history.History.capacityFor(intent_capacity));
        errdefer a.free(history);
        const event_masks = try a.alloc(usize, intent_masks.len);
        errdefer a.free(event_masks);
        var memory = try remembered.Memory.init(a);
        errdefer memory.deinit(a);

        @memset(history, .{});
        @memset(intent_masks, 0);
        @memset(event_masks, 0);
        @memset(established, null);
        @memset(rows, .{});
        @memset(slots, identity_index.empty);
        @memset(connections, null);
        var result: Catalog = .{
            .rows = rows,
            .options = options,
            .intent_capacity = intent_capacity,
            .intents = .{ .bit_length = rows.len, .masks = intent_masks.ptr },
            .intent_masks = intent_masks,
            .history = .{ .entries = history, .seed = seed },
            .remembered = memory,
            .established = established,
            .random = .init(seed),
            .by_identity = .{ .slots = slots, .seed = seed },
            .by_connection = connections,
            .events = .{ .bit_length = rows.len, .masks = event_masks.ptr },
            .event_masks = event_masks,
        };
        for (0..rows.len) |index| result.free.append(rows, "free_link", @intCast(index));
        return result;
    }

    pub fn deinit(self: *Catalog, a: std.mem.Allocator) void {
        self.remembered.deinit(a);
        a.free(self.event_masks);
        a.free(self.history.entries);
        a.free(self.intent_masks);
        a.free(self.established);
        a.free(self.by_connection);
        a.free(self.by_identity.slots);
        a.free(self.rows);
        self.* = undefined;
    }

    pub fn directPeers(self: *const Catalog, out: []t.PeerId) error{OutputTooSmall}!usize {
        if (out.len < self.direct_count) return error.OutputTooSmall;
        var count: usize = 0;
        var it = self.intents.iterator(.{});
        while (it.next()) |index| {
            const row = &self.rows[index];
            if (!row.direct) continue;
            out[count] = row.identity;
            count += 1;
        }
        std.debug.assert(count == self.direct_count);
        return count;
    }

    pub fn prepareCandidateCustody(row: *Row, context: *const t.ForkContext) void {
        if (row.connection != null) return;
        const hints = row.dial.hints orelse return;
        const count = hints.custody_group_count orelse context.custody_requirement;
        if (!hints.validFor(context) or count == 0) {
            row.custody_work = null;
            return;
        }
        if (std.meta.eql(row.custody_context, context.*)) if (row.custody_work) |work| if (work.custody_count == count and work.sampling_count == count) return;
        row.custody_context = context.*;
        row.custody_work = custody.SamplingDerivation.init(&row.node_id.?, .{ .groups = context.custody_groups, .columns = preset.NUMBER_OF_COLUMNS }, count, 0) catch null;
    }

    pub fn candidateCoverage(row: *const Row, context: *const t.ForkContext, now_ms: u64) t.Coverage {
        const hints = row.dial.hints orelse return .{};
        if (now_ms >= row.dial.hints_at_ms +| hint_freshness_ms or !hints.validFor(context)) return .{};
        var result: t.Coverage = .{ .attnets = if (hints.attnets) |bits| std.mem.readInt(u64, &bits, .little) else 0, .syncnets = @intCast(hints.syncnets orelse 0) };
        const count = hints.custody_group_count orelse context.custody_requirement;
        if (std.meta.eql(row.custody_context, context.*)) if (row.custody_work) |*work| {
            if (work.custody_count == count) if (work.complete()) |derived| {
                result.groups = derived.custody;
                result.custody_groups = derived.custody;
            };
        };
        return result;
    }

    pub fn advanceCustody(self: *Catalog, context: *const t.ForkContext, now_ms: u64, freshness_ms: u64, budget: *u16) bool {
        var connected_budget: u16 = @min(budget.*, custody.hashes_per_turn / 2);
        const reserved = connected_budget;
        const connected_pending = self.advanceConnectedCustody(context, now_ms, freshness_ms, &connected_budget);
        budget.* -= reserved - connected_budget;
        var pending = connected_pending;
        // Scan both halves of the intent index from a rotating start, including unselected hints.
        for (0..2) |half| {
            var it = self.intents.iterator(.{});
            while (it.next()) |index| {
                if ((index < self.candidate_custody_cursor) != (half == 1)) continue;
                const row = &self.rows[index];
                if (row.connection != null) continue;
                const before_context = row.custody_context;
                const had_work = row.custody_work != null;
                prepareCandidateCustody(row, context);
                if (!std.meta.eql(before_context, row.custody_context) or had_work != (row.custody_work != null)) self.intents_dirty = true;
                if (now_ms >= row.dial.hints_at_ms +| hint_freshness_ms) continue;
                const work = if (row.custody_work) |*value| value else continue;
                const before = work.totalHashes();
                const result = work.step(@min(custody.hashes_per_row, budget.*)) catch {
                    budget.* -= work.totalHashes() - before;
                    continue;
                };
                budget.* -= work.totalHashes() - before;
                if (work.totalHashes() != before and result != null) self.intents_dirty = true;
                pending = pending or result == null;
            }
        }
        self.candidate_custody_cursor = (self.candidate_custody_cursor + 1) % self.rows.len;
        return pending;
    }

    fn advanceConnectedCustody(self: *Catalog, context: *const t.ForkContext, now_ms: u64, freshness_ms: u64, budget: *u16) bool {
        var pending = false;
        for (0..self.rows.len) |_| {
            const index = self.custody_cursor;
            const row = &self.rows[index];
            self.custody_cursor = (self.custody_cursor + 1) % self.rows.len;
            if (!row.occupied or row.connection == null or row.closing_reason != null) continue;
            const metadata = row.metadata orelse continue;
            const count = metadata.custody_group_count orelse {
                if (row.custody_work != null) self.selection_dirty = true;
                row.custody_work = null;
                continue;
            };
            const compatible = if (row.status) |status| std.mem.eql(u8, &status.fork_digest, &context.digest) else false;
            if (count == 0 or count > context.custody_groups or !compatible) {
                if (row.custody_work != null) self.selection_dirty = true;
                row.custody_work = null;
                continue;
            }
            var completed = if (row.custody_work) |*work| work.complete() != null else false;
            if (!std.meta.eql(row.custody_context, context.*) or (if (row.custody_work) |work| work.custody_count != count else true)) {
                self.selection_dirty = true;
                row.custody_work = null;
                row.custody_context = context.*;
                if (row.node_id == null) row.node_id = custody.nodeId(&row.identity) catch continue;
                row.custody_work = custody.SamplingDerivation.init(&row.node_id.?, .{ .groups = context.custody_groups, .columns = preset.NUMBER_OF_COLUMNS }, count, context.minimum_sampling_groups) catch continue;
                completed = false;
            }
            if (now_ms >= row.metadata_at_ms +| freshness_ms) continue;
            const work = &row.custody_work.?;
            const before = work.totalHashes();
            const result = work.step(@min(custody.hashes_per_row, budget.*)) catch {
                budget.* -= work.totalHashes() - before;
                continue;
            };
            budget.* -= work.totalHashes() - before;
            if (!completed and result != null) {
                self.selection_dirty = true;
                row.pending_update = true;
                self.syncEvent(index);
            }
            pending = pending or result == null;
        }
        // A rotating work start prevents a large configured catalog from monopolizing the budget.
        self.custody_cursor = (self.custody_cursor + 1) % self.rows.len;
        return pending;
    }
    pub fn find(self: *const Catalog, identity: *const t.PeerId) ?t.PeerRef {
        const index = self.by_identity.find(self.rows, identity) orelse return null;
        return .{ .index = index, .generation = self.rows[index].generation };
    }

    pub fn findConnection(self: *const Catalog, conn: t.Handle) ?t.PeerRef {
        if (conn.index >= self.by_connection.len) return null;
        const index = self.by_connection[conn.index] orelse return null;
        const row = &self.rows[index];
        return if (row.occupied and std.meta.eql(row.connection, conn)) .{ .index = index, .generation = row.generation } else null;
    }

    pub fn rowFor(self: *const Catalog, ref: t.PeerRef) ?*const Row {
        if (ref.index >= self.rows.len) return null;
        const row = &self.rows[ref.index];
        return if (row.occupied and row.generation == ref.generation) row else null;
    }

    pub fn edit(self: *Catalog, ref: t.PeerRef) ?*Row {
        if (self.rowFor(ref) == null) return null;
        return &self.rows[ref.index];
    }

    fn connectedRow(self: *Catalog, ref: t.PeerRef, conn: t.Handle) ?*Row {
        const row = self.rowFor(ref) orelse return null;
        const current = row.connection orelse return null;
        return if (std.meta.eql(current, conn)) self.edit(ref) else null;
    }

    pub fn get(self: *const Catalog, ref: t.PeerRef) ?t.Snapshot {
        const row = self.rowFor(ref) orelse return null;
        if (row.established_slot == null) return null;
        const derived = if (row.connection != null and row.custody_work != null) row.custody_work.?.complete() else null;
        var current = row.reputation;
        current.decay(self.clock_ms);
        return .{
            .peer = ref,
            .identity = row.identity,
            .connection = row.connection,
            .direction = row.direction,
            .endpoint = row.endpoint,
            .relevant = row.connection != null and row.status != null,
            .disconnect_reason = row.closing_reason,
            .status = row.status,
            .metadata = row.metadata,
            .identify = row.identify,
            .status_at_ms = row.status_at_ms,
            .metadata_at_ms = row.metadata_at_ms,
            .custody_groups = if (derived) |value| value.custody else null,
            .sampling_groups = if (derived) |value| value.sampling else null,
            .connected_at_ms = row.connected_at_ms,
            .direct = row.direct,
            .score = current.score,
            .score_at_ms = current.decay_at_ms,
            .ban_until_ms = row.reputation.ban_until_ms,
            .goodbye_until_ms = row.reputation.goodbye_until_ms,
            .redial_until_ms = row.reputation.redial_until_ms,
        };
    }

    pub fn snapshots(self: *const Catalog, out: []t.Snapshot) usize {
        var count: usize = 0;
        for (self.rows, 0..) |row, index| {
            if (count == out.len) break;
            if (row.established_slot == null) continue;
            out[count] = self.get(.{ .index = @intCast(index), .generation = row.generation }).?;
            count += 1;
        }
        return count;
    }

    /// Identity and connection metadata must come from authenticated transport state, with
    /// endpoints normalized by Address.fromNetwork.
    pub fn admit(
        self: *Catalog,
        identity: *const t.PeerId,
        local: *const t.PeerId,
        conn: t.Handle,
        options: *const AdmissionOptions,
    ) Admission {
        std.debug.assert(conn.index < self.by_connection.len);
        if (identity.eql(local)) return .duplicate;
        if (self.find(identity)) |ref| {
            const row = self.edit(ref).?;
            var current_reputation = row.reputation;
            current_reputation.decay(options.now_ms);
            if (current_reputation.banned(options.now_ms)) return .banned;
            if (options.now_ms < current_reputation.goodbye_until_ms or
                (options.direction == .inbound and !row.direct and options.now_ms < current_reputation.redial_until_ms)) return .cooldown;
            if (row.pending_close != null) return .pending;
            var displaced: ?t.Handle = null;
            if (row.connection) |current| {
                const local_smaller = std.mem.order(u8, &local.bytes, &identity.bytes) == .lt;
                const preferred: t.Direction = if (local_smaller)
                    .outbound
                else
                    .inbound;
                if (std.meta.eql(current, conn) or row.direction == options.direction or
                    options.direction != preferred) return .duplicate;
                displaced = current;
            } else if (!self.admissionRoom(row.direct, options)) return .capacity;
            if (options.direction == .inbound and !self.sourceRoom(&options.endpoint, ref.index)) return .capacity;
            const fresh = row.established_slot == null;
            if (fresh and !self.promote(ref, options.direction, options.now_ms)) return .capacity;
            if (row.connection == null) self.connected_count += 1;
            row.reputation = current_reputation;
            if (displaced) |old| self.by_connection[old.index] = null;
            connect(row, conn, options);
            self.by_connection[conn.index] = ref.index;
            self.selection_dirty = true;
            self.intents_dirty = true;
            self.dial_schedule_dirty = true;
            self.syncEvent(ref.index);
            return .{ .admitted = .{ .peer = ref, .displaced = displaced, .fresh = fresh } };
        }
        if (!self.admissionRoom(false, options)) return .capacity;
        if (options.direction == .inbound and !self.sourceRoom(&options.endpoint, null)) return .capacity;
        const slot = self.reclaimable(options.direction, options.now_ms) orelse return .capacity;
        if (self.established[slot]) |victim| self.forget(self.reference(victim));
        const ref = self.allocate(identity) orelse return .capacity;
        self.established[slot] = ref.index;
        const row = self.edit(ref).?;
        row.established_slot = @intCast(slot);
        connect(row, conn, options);
        self.connected_count += 1;
        self.by_connection[conn.index] = ref.index;
        self.selection_dirty = true;
        self.intents_dirty = true;
        self.dial_schedule_dirty = true;
        self.syncEvent(ref.index);
        return .{ .admitted = .{ .peer = ref, .fresh = true } };
    }

    fn admissionRoom(self: *const Catalog, direct: bool, options: *const AdmissionOptions) bool {
        const remaining = self.options.max_peers -| self.connectedCount();
        if (remaining <= options.pending_dials) return false;
        return options.direction == .outbound or direct or options.selected_dial or remaining > options.outbound_reserved;
    }

    fn sourceRoom(self: *const Catalog, endpoint: *const t.Address, except: ?u16) bool {
        var count: u16 = 0;
        for (self.by_connection) |slot| {
            const index = slot orelse continue;
            if (except == index) continue;
            const row = &self.rows[index];
            if (row.direction != .inbound) continue;
            const matches = switch (endpoint.*) {
                .ip4 => |source| row.endpoint == .ip4 and std.mem.eql(u8, &source.octets, &row.endpoint.ip4.octets),
                .ip6 => |source| row.endpoint == .ip6 and std.mem.eql(u8, source.octets[0..8], row.endpoint.ip6.octets[0..8]),
            };
            if (!matches) continue;
            count += 1;
            if (count >= self.options.inbound_per_source_max) return false;
        }
        return true;
    }

    pub fn reference(self: *const Catalog, index: usize) t.PeerRef {
        std.debug.assert(self.rows[index].occupied);
        return .{ .index = @intCast(index), .generation = self.rows[index].generation };
    }

    fn allocate(self: *Catalog, identity: *const t.PeerId) ?t.PeerRef {
        for (0..self.rows.len) |_| {
            const index = self.free.pop(self.rows, "free_link") orelse return null;
            const row = &self.rows[index];
            if (row.generation == std.math.maxInt(u64)) continue;
            row.* = .{ .occupied = true, .generation = row.generation + 1, .identity = identity.* };
            self.by_identity.insert(self.rows, @intCast(index));
            return self.reference(index);
        }
        return null;
    }

    pub fn retainIntent(self: *Catalog, identity: *const t.PeerId) error{Capacity}!t.PeerRef {
        const existing = self.find(identity);
        if (existing) |peer| if (self.intents.isSet(peer.index)) return peer;
        if (self.intent_count == self.intent_capacity) return error.Capacity;
        const peer = existing orelse self.allocate(identity) orelse return error.Capacity;
        self.intents.set(peer.index);
        self.intent_count += 1;
        self.intents_dirty = true;
        self.dial_schedule_dirty = true;
        return peer;
    }

    /// Releases dial capacity without discarding an established peer's addresses or ENR hints.
    pub fn releaseIntent(self: *Catalog, peer: t.PeerRef) void {
        const row = self.edit(peer) orelse return;
        std.debug.assert(!row.direct and row.attempt == null);
        if (self.intents.isSet(peer.index)) {
            self.intents.unset(peer.index);
            self.intent_count -= 1;
            self.intents_dirty = true;
            self.dial_schedule_dirty = true;
        }
        if (row.established_slot == null) {
            self.forget(peer);
        } else if (row.connection == null) {
            row.custody_work = null;
            row.custody_context = null;
        }
    }

    fn forget(self: *Catalog, peer: t.PeerRef) void {
        const row = self.edit(peer).?;
        std.debug.assert(row.connection == null and row.attempt == null and !row.direct and row.pending_close == null and !row.pending_update);
        self.by_identity.remove(self.rows, &row.identity);
        if (row.established_slot) |slot| {
            self.established[slot] = null;
        }
        if (self.intents.isSet(peer.index)) {
            self.intents.unset(peer.index);
            self.intent_count -= 1;
            self.intents_dirty = true;
            self.dial_schedule_dirty = true;
        }
        assert(!self.events.isSet(peer.index));
        row.* = .{ .generation = row.generation };
        self.free.prepend(self.rows, "free_link", peer.index);
    }

    fn promote(self: *Catalog, peer: t.PeerRef, direction: t.Direction, now_ms: u64) bool {
        const slot = self.reclaimable(direction, now_ms) orelse return false;
        if (self.established[slot]) |victim| self.forget(self.reference(victim));
        self.established[slot] = peer.index;
        self.rows[peer.index].established_slot = @intCast(slot);
        return true;
    }

    fn reclaimable(self: *const Catalog, direction: t.Direction, now_ms: u64) ?usize {
        const limit = self.established.len - if (direction == .inbound)
            @as(usize, self.options.outbound_reserve)
        else
            0;
        for (self.established[0..limit], 0..) |entry, slot| if (entry == null) return slot;
        var victim: ?usize = null;
        var victim_banned = false;
        var victim_deadline: u64 = 0;
        for (self.established[0..limit], 0..) |entry, slot| {
            const index = entry.?;
            const row = &self.rows[index];
            if (row.connection != null or row.direct or row.attempt != null or row.dial.manual_until_ms > now_ms or row.pending_close != null or
                row.pending_update or row.generation == std.math.maxInt(u64)) continue;
            var current_reputation = row.reputation;
            current_reputation.decay(now_ms);
            if (!current_reputation.retained(now_ms)) return slot;
            const banned = current_reputation.banned(now_ms);
            const deadline = current_reputation.nextDeadline(now_ms) orelse now_ms;
            if (victim == null or (victim_banned and !banned) or
                (victim_banned == banned and deadline < victim_deadline))
            {
                victim = slot;
                victim_banned = banned;
                victim_deadline = deadline;
            }
        }
        return victim;
    }

    fn connect(row: *Row, conn: t.Handle, options: *const AdmissionOptions) void {
        std.log.scoped(.network_peers).debug("peer_admitted peer={f} connection={d}:{d} direction={s}", .{ logging.peer(&row.identity), conn.index, conn.generation, @tagName(options.direction) });
        row.identify = null;
        row.custody_work = null;
        row.custody_context = null;
        if (row.node_id == null) row.node_id = options.node_id;
        row.connection = conn;
        row.closing_reason = null;
        row.direction = options.direction;
        row.endpoint = options.endpoint;
        row.dialed = null;
        row.origin = null;
        row.connected_at_ms = options.now_ms;
        row.status = null;
        row.metadata = null;
        row.status_at_ms = 0;
        row.metadata_at_ms = 0;
        row.pending_update = row.published;
    }

    pub fn eventsPending(self: *const Catalog) bool {
        if (@import("builtin").is_test) self.checkEvents();
        return self.event_count != 0;
    }

    /// Keeps `events` equal to the rows holding a pending close or update.
    fn syncEvent(self: *Catalog, index: usize) void {
        const row = &self.rows[index];
        const pending = row.pending_close != null or row.pending_update;
        if (pending == self.events.isSet(index)) return;
        if (pending) {
            self.events.set(index);
            self.event_count += 1;
        } else {
            self.events.unset(index);
            self.event_count -= 1;
        }
    }

    /// Test builds check that `events` holds exactly the rows with a pending close or update.
    fn checkEvents(self: *const Catalog) void {
        var count: usize = 0;
        for (self.rows, 0..) |*row, index| {
            const pending = row.pending_close != null or row.pending_update;
            assert(pending == self.events.isSet(index));
            count += @intFromBool(pending);
        }
        assert(count == self.event_count);
    }

    pub fn connectedCount(self: *const Catalog) u16 {
        return self.connected_count;
    }

    pub const CloseEvidence = struct {
        /// The connection completed valid Status and Metadata exchanges.
        ready: bool = false,
        rejection: ?t.Rejection = null,
    };

    /// Records close evidence before clearing the connection and applying its retry policy.
    /// Duplicate and stale connections have no effect.
    pub fn disconnect(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        reason: t.DisconnectReason,
        evidence: CloseEvidence,
        now: Now,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        const now_ms = now.millis();
        self.settleRejections(ref, row, evidence, now_ms);
        if (evidence.ready)
            self.serve(row, servedUntil(reason) and (evidence.rejection == null or evidence.rejection == .shutdown), now);
        std.log.scoped(.network_peers).debug("peer_disconnected peer={f} connection={d}:{d} reason={s} connected_ms={d} relevant={any} agent={f}", .{ logging.peer(&row.identity), conn.index, conn.generation, @tagName(reason), now_ms -| row.connected_at_ms, row.status != null, std.json.fmt(client.agent(&row.identify), .{}) });
        self.selection_dirty = true;
        self.by_connection[conn.index] = null;
        self.connected_count -= 1;
        self.intents_dirty = true;
        self.dial_schedule_dirty = true;
        row.connection = null;
        row.custody_work = null;
        row.custody_context = null;
        row.status = null;
        row.metadata = null;
        row.pending_update = false;
        row.pending_close = .{ .connection = conn, .reason = reason };
        row.reputation.decay(now_ms);
        self.connectionClosed(ref.index, reason, now_ms);
        self.syncEvent(ref.index);
        return true;
    }

    fn connectionClosed(self: *Catalog, index: usize, reason: t.DisconnectReason, now_ms: u64) void {
        const row = &self.rows[index];
        row.dial.replacement_after_ms = @max(row.dial.replacement_after_ms, now_ms +| replacement_grace_ms);
        if (reason == .capacity or reason == .count_pruning) {
            if (row.reputation.redial_until_ms <= now_ms)
                row.reputation.deferRedial(now_ms, goodbye.cooldownMs(129));
        } else {
            row.dial.connectionClosed(now_ms, now_ms -| row.connected_at_ms, self.random.random().int(u16) % 1_001);
            if (reason == .health_timeout or reason == .health_error) {
                self.remembered.forget(&row.identity);
                self.recordHealth(index, now_ms);
            }
        }
        if (!row.dial.automatic) return;
        if (reason == .transport_closed) {
            _ = self.retainIntent(&row.identity) catch {
                row.dial.automatic = false;
                return;
            };
        } else {
            row.dial.automatic = false;
            if (!row.direct and row.dial.manual_until_ms == 0 and row.attempt == null)
                self.releaseIntent(self.reference(index));
        }
    }

    /// Charges a health close to the dialed endpoint; an inbound connection says nothing about
    /// the peer's advertised endpoints. History survives reclamation of the established row.
    fn recordHealth(self: *Catalog, index: usize, now_ms: u64) void {
        const row = &self.rows[index];
        const key = self.history.endpointKey(&row.identity, row.dialed orelse return);
        const dial = &row.dial;
        const sequence = if (dial.hints) |hints| hints.sequence else 0;
        self.history.recordEndpoint(key, .health, sequence, now_ms);
        self.history.markRetry(key, .health, now_ms);
    }

    /// Clears the connection-failure evidence of the endpoint the connection was dialed to. Control
    /// calls it once the connection completed a valid relevant Status and a valid Metadata exchange:
    /// a QUIC handshake alone does not show the endpoint serves the peer.
    pub fn clearDialFailures(self: *Catalog, ref: t.PeerRef, conn: t.Handle) void {
        const row = self.connectedRow(ref, conn) orelse return;
        const endpoint = row.dialed orelse return;
        self.history.clearFailures(self.history.endpointKey(&row.identity, endpoint));
    }

    /// A ready connection kept for at least `kept_connection_ms` clears earlier rejections before
    /// recording this close's rejection. Rejecting the discovery intent requires rediscovery after
    /// the block passes before another automatic dial.
    fn settleRejections(self: *Catalog, ref: t.PeerRef, row: *Row, evidence: CloseEvidence, now_ms: u64) void {
        const key = self.history.identityKey(&row.identity);
        if (evidence.ready and now_ms -| row.connected_at_ms >= dial_history.kept_connection_ms) self.history.clearRejections(key);
        const kind = evidence.rejection orelse return;
        const block_ms = self.history.reject(key, kind, now_ms);
        self.rejections[@intFromEnum(kind)] +|= 1;
        if (kind != .shutdown) self.remembered.forget(&row.identity);
        const conn = row.connection.?;
        std.log.scoped(.network_peers).debug("peer_rejection_recorded peer={f} connection={d}:{d} kind={s} block_ms={d}", .{ logging.peer(&row.identity), conn.index, conn.generation, @tagName(kind), block_ms });
        if (!row.dial.automatic) return;
        row.dial.automatic = false;
        if (!row.direct and row.dial.manual_until_ms == 0 and row.attempt == null) self.releaseIntent(ref);
    }

    /// Refreshes the remembered record of every connection that qualifies now: our dial, admitted
    /// `qualify_ms` ago, holding a relevant Status and a Metadata, and not closing.
    pub fn rememberConnected(self: *Catalog, now: Now) void {
        for (self.established) |entry| {
            const row = &self.rows[entry orelse continue];
            if (row.connection == null or row.closing_reason != null or row.status == null or row.metadata == null) continue;
            self.serve(row, true, now);
        }
    }

    /// A ready connection that served `qualify_ms` counts once as kept, and refreshes the record of
    /// its dialed endpoint while the peer stays eligible. Inbound connections prove no endpoint.
    fn serve(self: *Catalog, row: *Row, eligible: bool, now: Now) void {
        if (now.millis() -| row.connected_at_ms < remembered.qualify_ms) return;
        if (row.origin) |origin| {
            self.remembered.note(origin, .kept);
            row.origin = null;
        }
        const endpoint = row.dialed orelse return;
        var current = row.reputation;
        current.decay(now.millis());
        if (!eligible or current.banned(now.millis()) or !endpoint.isUsable()) return;
        self.remembered.qualify(&row.identity, endpoint, remembered.seconds(now));
    }

    /// Clears the health evidence of the endpoint the connection was dialed to. Control calls it once
    /// a probe started after the Status and Metadata exchange succeeded, so a peer that answers that
    /// exchange and then stops answering keeps its strikes across reconnects.
    pub fn clearHealthStrikes(self: *Catalog, ref: t.PeerRef, conn: t.Handle) void {
        const row = self.connectedRow(ref, conn) orelse return;
        self.history.clearHealth(self.history.endpointKey(&row.identity, row.dialed orelse return));
    }

    pub fn markUnavailable(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        reason: t.DisconnectReason,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return true;
        self.selection_dirty = true;
        row.closing_reason = reason;
        row.status = null;
        row.pending_update = row.published;
        self.syncEvent(ref.index);
        return true;
    }

    pub fn invalidateStatus(self: *Catalog, ref: t.PeerRef, conn: t.Handle) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return false;
        if (row.status == null and row.custody_work == null) return true;
        self.selection_dirty = true;
        row.status = null;
        row.custody_work = null;
        row.pending_update = row.published;
        self.syncEvent(ref.index);
        return true;
    }

    /// Only a decoded Status accepted by the relevance check may establish relevance.
    pub fn updateStatus(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        status: *const t.Status,
        now_ms: u64,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return false;
        self.selection_dirty = true;
        row.status = status.*;
        row.dial.replacement_after_ms = @max(row.dial.replacement_after_ms, now_ms +| replacement_grace_ms);
        row.status_at_ms = now_ms;
        row.pending_update = true;
        self.syncEvent(ref.index);
        return true;
    }

    pub fn updateIdentify(self: *Catalog, ref: t.PeerRef, conn: t.Handle, metadata: *const identify_mod.Metadata) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return false;
        row.identify = metadata.*;
        self.selection_dirty = true;
        if (row.published or row.status != null) row.pending_update = true;
        self.syncEvent(ref.index);
        return true;
    }

    /// Apply a validated, normalized transport endpoint. Close on SourceCapacity without a peer penalty.
    pub fn updateEndpoint(self: *Catalog, ref: t.PeerRef, conn: t.Handle, endpoint: *const t.Address) error{SourceCapacity}!bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return false;
        if (row.endpoint.eql(endpoint.*)) return true;
        if (row.direction == .inbound and !self.sourceRoom(endpoint, ref.index)) return error.SourceCapacity;
        row.endpoint = endpoint.*;
        self.selection_dirty = true;
        if (row.published) row.pending_update = true;
        self.syncEvent(ref.index);
        return true;
    }

    pub fn updateMetadata(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        metadata: *const t.Metadata,
        now_ms: u64,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        if (row.closing_reason != null) return false;
        if (row.metadata) |current| {
            if (metadata.seq_number < current.seq_number) return false;
            if (std.meta.eql(current, metadata.*)) {
                row.metadata_at_ms = now_ms;
                return true;
            }
        }
        if (row.metadata == null or row.metadata.?.custody_group_count != metadata.custody_group_count) row.custody_work = null;
        self.selection_dirty = true;
        row.metadata = metadata.*;
        row.metadata_at_ms = now_ms;
        if (row.published or row.status != null) row.pending_update = true;
        self.syncEvent(ref.index);
        return true;
    }

    pub fn setDirect(self: *Catalog, ref: t.PeerRef, direct: bool) bool {
        const row = self.edit(ref) orelse return false;
        if (row.direct != direct) {
            self.selection_dirty = true;
            self.intents_dirty = true;
            self.dial_schedule_dirty = true;
            if (direct) self.direct_count += 1 else self.direct_count -= 1;
        }
        row.direct = direct;
        return true;
    }

    pub fn report(
        self: *Catalog,
        ref: t.PeerRef,
        action: t.PeerAction,
        now_ms: u64,
    ) ?t.ReputationDecision {
        const row = self.edit(ref) orelse return null;
        if (row.established_slot == null) return null;
        self.selection_dirty = true;
        if (self.intents.isSet(ref.index)) self.dial_schedule_dirty = true;
        const decision = row.reputation.apply(action, now_ms);
        // A local ban forgets the peer whether or not a connection is left to close.
        if (decision == .ban) self.remembered.forget(&row.identity);
        return decision;
    }

    pub fn nonCompletion(self: *Catalog, ref: t.PeerRef, now_ms: u64) bool {
        const row = self.edit(ref) orelse return false;
        if (row.established_slot == null) return false;
        const before = row.reputation.score;
        if (self.intents.isSet(ref.index)) self.dial_schedule_dirty = true;
        row.reputation.nonCompletion(now_ms);
        if (before != row.reputation.score) self.selection_dirty = true;
        return true;
    }

    pub fn cooldown(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        now_ms: u64,
        duration_ms: u64,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        self.selection_dirty = true;
        if (self.intents.isSet(ref.index)) self.dial_schedule_dirty = true;
        row.reputation.cooldown(now_ms, duration_ms);
        return true;
    }

    pub fn advanceClock(self: *Catalog, now_ms: u64) void {
        self.clock_ms = @max(self.clock_ms, now_ms);
    }

    pub fn deferRedial(
        self: *Catalog,
        ref: t.PeerRef,
        conn: t.Handle,
        now_ms: u64,
        duration_ms: u64,
    ) bool {
        const row = self.connectedRow(ref, conn) orelse return false;
        self.selection_dirty = true;
        if (self.intents.isSet(ref.index)) self.dial_schedule_dirty = true;
        row.reputation.deferRedial(now_ms, duration_ms);
        return true;
    }

    /// Emits pending closes and updates in row order from the cursor, visiting only rows with one.
    pub fn pollEvents(self: *Catalog, out: []t.Event) usize {
        if (@import("builtin").is_test) self.checkEvents();
        if (out.len == 0 or self.event_count == 0) return 0;
        const start = self.event_cursor;
        var count: usize = 0;
        // The first half visits rows from the cursor to the end, the second the rows before it.
        outer: for (0..2) |half| {
            var it = self.events.iterator(.{});
            while (it.next()) |index| {
                if ((index < start) != (half == 1)) continue;
                if (count == out.len) break :outer;
                self.emitEvent(index, &out[count]);
                self.syncEvent(index);
                count += 1;
                self.event_cursor = (index + 1) % self.rows.len;
            }
        }
        // A pass that does not fill the output visits every row and ends where it started.
        if (count < out.len) self.event_cursor = start;
        return count;
    }

    fn emitEvent(self: *Catalog, index: usize, out: *t.Event) void {
        const row = &self.rows[index];
        assert(row.occupied);
        const ref: t.PeerRef = .{ .index = @intCast(index), .generation = row.generation };
        if (row.pending_close) |closed| {
            out.* = .{ .closed = .{
                .peer = ref,
                .identity = row.identity,
                .connection = closed.connection,
                .reason = closed.reason,
            } };
            row.pending_close = null;
            row.published = false;
            return;
        }
        assert(row.pending_update);
        const snapshot = self.get(ref).?;
        out.* = if (row.published)
            .{ .updated = snapshot }
        else
            .{ .ready = snapshot };
        row.pending_update = false;
        row.published = true;
    }
};

/// Whether a connection closing for `reason` served us until then. Closes for an incompatible or
/// failing peer do not.
fn servedUntil(reason: t.DisconnectReason) bool {
    return switch (reason) {
        .host, .shutdown, .transport_closed, .capacity, .remote_goodbye, .count_pruning => true,
        .incompatible_fork, .future_head, .finalized_mismatch, .missing_availability, .invalid_status, .invalid_metadata, .health_timeout, .reputation, .banned, .gossip_unavailable, .gossip_send_timeout, .health_error => false,
    };
}

test {
    _ = @import("catalog_test.zig");
}
