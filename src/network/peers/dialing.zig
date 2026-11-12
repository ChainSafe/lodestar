const std = @import("std");
const time = @import("../time.zig");
const Catalog = @import("catalog.zig").Catalog;
const Row = Catalog.Row;
const policy = @import("policy.zig");
const enr = @import("enr.zig");
const t = @import("types.zig");
const dial_history = @import("dial_history.zig");
const remembered = @import("remembered.zig");
const Engine = @import("../quic/Engine.zig");
const Now = @import("../types.zig").Now;
const Schedule = @import("../types.zig").Schedule;
const assert = std.debug.assert;
const histogram = @import("../metrics/histogram.zig");

const replacement_grace_ms = Catalog.replacement_grace_ms;
const hint_freshness_ms = Catalog.hint_freshness_ms;
const candidates_max = 4096;

const Attempt = struct {
    generation: u64 = 0,
    selected_ms: u64 = 0,
    peer: ?t.PeerRef = null,
    connection: ?t.Handle = null,
    answered: bool = false,
    lease_until_ms: u64 = 0,
    /// The dialed endpoint, which a discovery refresh may drop from the row's addresses mid-flight.
    address: t.Address = .unspecified,
};

pub const Dialing = struct {
    pub const Token = struct { index: u16, generation: u64 };
    pub const SelectedDial = struct { token: Token, peer: t.PeerId, address: t.Address };
    /// `outbound_reserved` peer slots stay closed to unselected inbound admission so dials can land.
    pub const Options = struct { capacity: u16 = 256, concurrent_max: u16 = 4, outbound_reserved: u16 = 0, seed: u64 };
    /// Unanswered QUIC dials cost one handshake slot each, so the table is sized for dead endpoints,
    /// not for peer headroom.
    pub const attempts_max = 64;
    pub const connect_timeout_ms: u64 = 30_000;
    pub const Source = enum { discovery, manual, direct };
    pub const DialTime = histogram.Duration(&.{ 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000 });

    options: Options,
    active: [attempts_max]Attempt = @splat(.{}),
    /// Disconnected manual and direct intents counted by configureSelection.
    host_demand: u16 = 0,
    selection_deadline: ?u64 = null,
    cursor: usize = 0,
    preferred_starts: u16 = 0,
    random: std.Random.DefaultPrng,
    selected_attempts: [std.meta.fields(Source).len]u64 = @splat(0),
    outcomes: [std.meta.fields(t.DialOutcome).len]u64 = @splat(0),
    /// Time from selection to retirement by outcome; each count equals its outcome counter.
    durations: [std.meta.fields(t.DialOutcome).len]DialTime = @splat(.{}),
    /// Redials of an endpoint by its previous failure, each counted when the redial is selected.
    retries: [std.meta.fields(t.DialFailure).len]u64 = @splat(0),
    /// Discovered candidates refused because every endpoint recently failed, or because the
    /// identity recently rejected us, by that rejection.
    refused: struct { endpoint: u64 = 0, identity: [std.meta.fields(t.Rejection).len]u64 = @splat(0) } = .{},
    /// Attempts held, and those not yet started on a connection.
    held: Attempts = .{},
    next_eligible_ms: ?u64 = null,
    manual_expiry_ms: ?u64 = null,

    pub fn validateOptions(options: Options) error{InvalidOptions}!void {
        if (options.capacity == 0 or options.capacity > candidates_max or options.concurrent_max == 0 or
            options.concurrent_max > attempts_max or options.concurrent_max > options.capacity or
            options.outbound_reserved > options.concurrent_max) return error.InvalidOptions;
    }
    pub fn init(options: Options) !Dialing {
        try validateOptions(options);
        return .{ .options = options, .random = .init(options.seed) };
    }
    pub fn enqueue(self: *Dialing, catalog: *Catalog, peer: *const t.PeerId, addresses: []const t.Address, direct: bool, now_ms: u64) !void {
        return self.enqueueUntil(catalog, peer, addresses, direct, now_ms, now_ms +| connect_timeout_ms);
    }
    pub fn enqueueUntil(self: *Dialing, catalog: *Catalog, peer: *const t.PeerId, addresses: []const t.Address, direct: bool, now_ms: u64, deadline_ms: u64) !void {
        if (deadline_ms <= now_ms or deadline_ms - now_ms > 86_400_000) return error.InvalidDeadline;
        if (addresses.len == 0 or addresses.len > 2) return error.InvalidAddress;
        for (addresses) |address| if (address.port() == 0) return error.InvalidAddress;
        const existing = catalog.find(peer);
        var prepared: [2]t.Address = undefined;
        var count: u8 = 0;
        var address_index: u8 = 0;
        if (existing) |ref| {
            const dial = &catalog.rowFor(ref).?.dial;
            if (catalog.intents.isSet(ref.index) and !dial.automatic) {
                prepared = dial.addresses;
                count = dial.address_count;
                address_index = dial.address_index;
            }
        }
        for (addresses) |address| {
            var found = false;
            for (prepared[0..count]) |known| found = found or known.eql(address);
            if (found) continue;
            if (count == prepared.len) return error.AddressCapacity;
            prepared[count] = address;
            count += 1;
        }
        const ref = try catalog.retainIntent(peer);
        const row = catalog.edit(ref).?;
        row.dial.addresses = prepared;
        row.dial.address_count = count;
        row.dial.address_index = address_index;
        row.dial.automatic = false;
        row.dial.origin = .fresh;
        if (direct) _ = catalog.setDirect(ref, true);
        if (!direct) row.dial.manual_until_ms = @max(row.dial.manual_until_ms, deadline_ms);
        catalog.intents_dirty = true;
        catalog.dial_schedule_dirty = true;
        if (row.connection) |conn| self.accepted(catalog, ref, conn, now_ms);
    }

    /// Requires Discovery.advance output with authenticated source scope and a verified ENR.
    pub fn enqueueDiscovered(self: *Dialing, catalog: *Catalog, candidate: *const enr.Candidate, context: *const t.ForkContext, wanted: *const t.Coverage, now_ms: u64) !void {
        try context.validate();
        if (candidate.address_count == 0 or candidate.address_count > 2) return error.InvalidCandidate;
        const hints = candidate.hints;
        if (!hints.validFor(context)) return error.InvalidCandidate;
        for (candidate.addresses[0..candidate.address_count]) |address| if (address.port() == 0) return error.InvalidCandidate;
        var incoming: Row = .{ .identity = candidate.peer, .node_id = candidate.node_id, .dial = .{ .automatic = true, .eligible_at_ms = now_ms, .replacement_after_ms = now_ms +| replacement_grace_ms, .hints = hints, .hints_at_ms = now_ms } };
        if (catalog.find(&candidate.peer)) |ref| {
            const row = catalog.edit(ref).?;
            if (row.node_id) |id| if (!std.mem.eql(u8, &id, &candidate.node_id)) return error.InvalidCandidate;
            if (row.dial.hints) |previous| {
                if (candidate.hints.sequence < previous.sequence) return error.StaleRecord;
                if (candidate.hints.sequence == previous.sequence) {
                    if (!std.meta.eql(previous, hints)) return error.StaleRecord;
                    if (row.dial.automatic) try mergeAddresses(&row.dial, candidate);
                    if (catalog.intents.isSet(ref.index) or (row.connection != null and row.dial.automatic)) {
                        row.dial.hints_at_ms = now_ms;
                        catalog.intents_dirty = true;
                        catalog.dial_schedule_dirty = true;
                        return;
                    }
                }
            }
            const retained = catalog.intents.isSet(ref.index);
            const admitted = admittedAddresses(catalog, &candidate.peer, candidate.addresses[0..candidate.address_count], candidate.hints.sequence, now_ms);
            if ((!retained or row.dial.automatic) and admitted.count == 0) return self.refuse(&admitted);
            if (!retained) {
                applyAddresses(&incoming.dial, &admitted);
                Catalog.prepareCandidateCustody(&incoming, context);
                if (row.connection == null) _ = try retainCandidate(catalog, &incoming, context, wanted, now_ms);
                row.dial.automatic = true;
            }
            row.node_id = candidate.node_id;
            row.dial.hints = hints;
            row.dial.hints_at_ms = now_ms;
            if (row.dial.automatic) applyAddresses(&row.dial, &admitted);
            Catalog.prepareCandidateCustody(row, context);
            catalog.intents_dirty = true;
            catalog.dial_schedule_dirty = true;
            return;
        }
        const admitted = admittedAddresses(catalog, &candidate.peer, candidate.addresses[0..candidate.address_count], candidate.hints.sequence, now_ms);
        if (admitted.count == 0) return self.refuse(&admitted);
        applyAddresses(&incoming.dial, &admitted);
        Catalog.prepareCandidateCustody(&incoming, context);
        const ref = try retainCandidate(catalog, &incoming, context, wanted, now_ms);
        const row = catalog.edit(ref).?;
        row.node_id = incoming.node_id;
        row.dial = incoming.dial;
        row.custody_work = incoming.custody_work;
        row.custody_context = incoming.custody_context;
        catalog.intents_dirty = true;
        catalog.dial_schedule_dirty = true;
    }
    fn refuse(self: *Dialing, admitted: *const Admitted) error{ RecentlyFailed, RecentlyRejected } {
        const kind = admitted.rejection orelse {
            self.refused.endpoint +|= 1;
            return error.RecentlyFailed;
        };
        self.refused.identity[@intFromEnum(kind)] +|= 1;
        return error.RecentlyRejected;
    }
    /// Offers each loaded record once to normal candidate admission, in prefix-diverse order.
    pub fn replayRemembered(catalog: *Catalog, context: *const t.ForkContext, wanted: *const t.Coverage, now: Now) usize {
        const memory = &catalog.remembered;
        var queued: usize = 0;
        for (0..remembered.capacity) |_| {
            const record = memory.nextReplay(remembered.seconds(now)) orelse break;
            const outcome = queueRemembered(catalog, &record, context, wanted, now.millis());
            memory.counters.replays[@intFromEnum(outcome)] +|= 1;
            queued += @intFromBool(outcome == .queued);
        }
        return queued;
    }
    /// A remembered candidate keeps its proven endpoint and has no ENR hints, so selection admits
    /// it only under general demand. It meets the identity's rejection memory, the endpoint's
    /// history, the peer's own dial deadlines and candidate replacement.
    fn queueRemembered(catalog: *Catalog, record: *const remembered.Record, context: *const t.ForkContext, wanted: *const t.Coverage, now_ms: u64) remembered.Replay {
        if (catalog.find(&record.peer)) |ref| {
            const row = catalog.rowFor(ref).?;
            if (row.connection != null or catalog.intents.isSet(ref.index)) return .known;
            if (eligibleAt(catalog, row, now_ms) > now_ms) return .failed;
        }
        const admitted = admittedAddresses(catalog, &record.peer, &.{record.address}, 0, now_ms);
        if (admitted.rejection != null) return .rejected;
        if (admitted.count == 0) return .failed;
        var incoming: Row = .{ .identity = record.peer, .dial = .{ .automatic = true, .origin = .remembered } };
        applyAddresses(&incoming.dial, &admitted);
        const ref = retainCandidate(catalog, &incoming, context, wanted, now_ms) catch return .capacity;
        const row = catalog.edit(ref).?;
        row.dial.automatic = true;
        row.dial.origin = .remembered;
        row.dial.deferUntil(now_ms);
        row.dial.replacement_after_ms = @max(row.dial.replacement_after_ms, now_ms +| replacement_grace_ms);
        applyAddresses(&row.dial, &admitted);
        catalog.intents_dirty = true;
        catalog.dial_schedule_dirty = true;
        return .queued;
    }
    fn retainCandidate(catalog: *Catalog, incoming: *const Row, context: *const t.ForkContext, wanted: *const t.Coverage, now_ms: u64) error{Capacity}!t.PeerRef {
        if (catalog.intent_count == catalog.intent_capacity) {
            const index = replacement(catalog, incoming, context, wanted, now_ms) orelse return error.Capacity;
            // Candidate replacement may retire discovery intent, never established reputation.
            catalog.edit(catalog.reference(index)).?.dial.automatic = false;
            catalog.releaseIntent(catalog.reference(index));
        }
        return catalog.retainIntent(&incoming.identity);
    }
    fn replacement(catalog: *const Catalog, incoming: *const Row, context: *const t.ForkContext, wanted: *const t.Coverage, now_ms: u64) ?usize {
        assert(catalog.intent_count <= candidates_max);
        const incoming_utility = candidatePriority(incoming, context, wanted, true, now_ms);
        var prefixes: [2 * candidates_max]u64 = undefined;
        var prefix_count: usize = 0;
        var population = catalog.intents.iterator(.{});
        while (population.next()) |index| {
            const dial = &catalog.rows[index].dial;
            for (dial.addresses[0..dial.address_count]) |address| {
                prefixes[prefix_count] = candidatePrefix(address);
                prefix_count += 1;
            }
        }
        const sorted = prefixes[0..prefix_count];
        std.sort.heap(u64, sorted, {}, std.sort.asc(u64));
        const incoming_population = prefixPopulation(sorted, &incoming.dial);
        var victim: ?usize = null;
        var victim_utility: u2 = 2;
        var victim_population: usize = 0;
        var it = catalog.intents.iterator(.{});
        while (it.next()) |index| {
            const row = &catalog.rows[index];
            if (row.connection != null or row.pending_close != null or row.pending_update or !row.dial.automatic or row.direct or row.attempt != null or
                row.dial.manual_until_ms != 0 or (row.dial.failures == 0 and now_ms < row.dial.eligible_at_ms) or
                row.generation == std.math.maxInt(u64)) continue;
            std.debug.assert(row.connection == null and row.pending_close == null and !row.pending_update);
            const usefulness: u2 = if (row.dial.failures != 0) 0 else candidatePriority(row, context, wanted, true, now_ms);
            if (incoming_utility < usefulness) continue;
            const peers_in_prefix = prefixPopulation(sorted, &row.dial);
            if (row.dial.failures == 0 and incoming_utility == usefulness) {
                if (incoming_population > peers_in_prefix) continue;
                const improves_diversity = incoming.dial.address_count > 0 and peers_in_prefix > incoming_population + 1;
                if (now_ms < row.dial.replacement_after_ms and !improves_diversity) continue;
            }
            if (victim == null or usefulness < victim_utility or (usefulness == victim_utility and
                (peers_in_prefix > victim_population or (peers_in_prefix == victim_population and row.dial.replacement_after_ms < catalog.rows[victim.?].dial.replacement_after_ms))))
            {
                victim = index;
                victim_utility = usefulness;
                victim_population = peers_in_prefix;
            }
        }
        return victim;
    }
    fn mergeAddresses(state: *Catalog.DialState, candidate: *const enr.Candidate) error{StaleRecord}!void {
        var addresses = state.addresses;
        var count = state.address_count;
        for (candidate.addresses[0..candidate.address_count]) |address| {
            var found = false;
            for (addresses[0..count]) |known| {
                if (std.meta.activeTag(known) != std.meta.activeTag(address)) continue;
                if (!known.eql(address)) return error.StaleRecord;
                found = true;
            }
            if (found) continue;
            if (count == addresses.len) return error.StaleRecord;
            addresses[count] = address;
            count += 1;
        }
        state.addresses = addresses;
        state.address_count = count;
    }
    fn candidatePriority(row: *const Row, context: *const t.ForkContext, wanted: *const t.Coverage, general: bool, now_ms: u64) u2 {
        if (row.dial.hints) |hints| if (!hints.validFor(context)) return 0;
        const available = Catalog.candidateCoverage(row, context, now_ms);
        if (available.attnets & wanted.attnets != 0 or available.syncnets & wanted.syncnets != 0 or
            available.custody_groups.intersectWith(wanted.custody_groups).count() > 0) return 2;
        // Prior service supports general connectivity, without claiming subnet coverage.
        return @intFromBool((general and row.dial.origin == .remembered) or policy.utility(&available, wanted) > 0);
    }
    pub fn configureSelection(self: *Dialing, catalog: *Catalog, wanted: *const t.Coverage, general: bool, context: *const t.ForkContext, now_ms: u64) void {
        self.selection_deadline = null;
        self.host_demand = 0;
        self.next_eligible_ms = null;
        self.manual_expiry_ms = null;
        var it = catalog.intents.iterator(.{});
        while (it.next()) |index| {
            const row = catalog.edit(catalog.reference(index)).?;
            if ((row.direct or row.dial.manual_until_ms != 0) and row.connection == null) self.host_demand += 1;
            const deadline = row.dial.hints_at_ms +| hint_freshness_ms;
            if (row.dial.hints != null and now_ms < deadline) self.selection_deadline = @min(self.selection_deadline orelse deadline, deadline);
            row.dial.priority = candidatePriority(row, context, wanted, general, now_ms);
            row.dial.selected = if (row.dial.hints) |hints|
                hints.validFor(context) and (general or row.dial.priority > 0)
            else
                general and row.dial.origin == .remembered;
            self.includeDeadlines(catalog, row, now_ms);
        }
        catalog.intents_dirty = false;
        catalog.dial_schedule_dirty = false;
    }
    pub const Attempts = struct { total: u16 = 0, unstarted: u16 = 0 };
    pub fn attempts(self: *const Dialing) Attempts {
        return self.held;
    }
    pub fn pendingPeers(self: *const Dialing, catalog: *const Catalog, except: ?*const t.PeerId) u16 {
        return self.countPeers(catalog, except, false);
    }
    pub fn syncAnswered(self: *Dialing, engine: *const Engine) void {
        for (&self.active) |*attempt| {
            if (attempt.peer == null or attempt.answered) continue;
            const conn = attempt.connection orelse continue;
            attempt.answered = engine.dialAnswered(conn);
        }
    }

    /// Dials the server answered are likely to land, so only they hold peer slots.
    pub fn answeredPeers(self: *const Dialing, catalog: *const Catalog, except: ?*const t.PeerId) u16 {
        return self.countPeers(catalog, except, true);
    }
    fn countPeers(self: *const Dialing, catalog: *const Catalog, except: ?*const t.PeerId, answered_only: bool) u16 {
        var count: u16 = 0;
        for (self.active) |attempt| if (attempt.peer) |peer| {
            if (answered_only and !attempt.answered) continue;
            const row = catalog.rowFor(peer).?;
            if (row.connection != null) continue;
            if (except) |identity| if (row.identity.eql(identity)) continue;
            count += 1;
        };
        return count;
    }
    pub fn selectedPeer(self: *const Dialing, catalog: *const Catalog, identity: *const t.PeerId, now_ms: u64) bool {
        const peer = catalog.find(identity) orelse return false;
        const index = catalog.rowFor(peer).?.attempt orelse return false;
        const attempt = &self.active[index];
        return std.meta.eql(attempt.peer, peer) and now_ms < attempt.lease_until_ms;
    }
    pub fn deferConnection(self: *Dialing, catalog: *Catalog, conn: t.Handle, now_ms: u64) bool {
        for (self.active, 0..) |attempt, index| {
            const peer = attempt.peer orelse continue;
            if (!std.meta.eql(attempt.connection, conn)) continue;
            const row = catalog.edit(peer).?;
            self.retire(catalog, @intCast(index), .admission_refused, now_ms);
            row.dial.deferUntil(now_ms +| 1_000);
            releaseUnused(catalog, peer);
            return true;
        }
        return false;
    }
    pub fn accepted(self: *Dialing, catalog: *Catalog, peer: t.PeerRef, conn: t.Handle, now_ms: u64) void {
        const row = catalog.edit(peer).?;
        std.debug.assert(std.meta.eql(row.connection, conn));
        row.dial.manual_until_ms = 0;
        catalog.intents_dirty = true;
        catalog.dial_schedule_dirty = true;
        if (row.attempt) |index| {
            const attempt = &self.active[index];
            if (attempt.connection) |current| {
                if (!std.meta.eql(current, conn)) return;
                row.dialed = attempt.address;
                if (discoveryOnly(row)) {
                    row.origin = row.dial.origin;
                    catalog.remembered.note(row.origin.?, .connected);
                }
            }
            self.retire(catalog, index, .connected, now_ms);
        }
        row.dial.deferUntil(now_ms +| 1_000);
        releaseUnused(catalog, peer);
    }
    pub fn cancelConnect(self: *Dialing, catalog: *Catalog, peer: *const t.PeerId, now_ms: u64) ?t.Handle {
        const ref = catalog.find(peer) orelse return null;
        const row = catalog.edit(ref).?;
        var close: ?t.Handle = null;
        row.dial.manual_until_ms = 0;
        catalog.intents_dirty = true;
        catalog.dial_schedule_dirty = true;
        if (row.attempt) |index| {
            close = self.active[index].connection;
            self.retire(catalog, index, .cancelled, now_ms);
        }
        row.dial.deferUntil(now_ms +| 60_000);
        releaseUnused(catalog, ref);
        return close;
    }
    pub fn dialClosed(self: *Dialing, catalog: *Catalog, conn: t.Handle, reason: t.CloseReason, now_ms: u64) bool {
        for (self.active, 0..) |attempt, index| {
            if (attempt.peer == null or !std.meta.eql(attempt.connection, conn)) continue;
            self.failed(catalog, @intCast(index), now_ms, closeFailure(reason), endpointEvidence(reason));
            return true;
        }
        return false;
    }
    fn attemptFor(self: *Dialing, token: Token) ?*Attempt {
        if (token.index >= self.active.len) return null;
        const attempt = &self.active[token.index];
        return if (attempt.peer != null and attempt.generation == token.generation) attempt else null;
    }
    pub fn dialStarted(self: *Dialing, token: Token, conn: t.Handle) bool {
        const attempt = self.attemptFor(token) orelse return false;
        if (attempt.connection != null) return false;
        attempt.connection = conn;
        self.held.unstarted -= 1;
        return true;
    }
    pub fn dialFailed(self: *Dialing, catalog: *Catalog, token: Token, now_ms: u64) bool {
        const attempt = self.attemptFor(token) orelse return false;
        if (attempt.connection != null) return false;
        self.failed(catalog, @intCast(token.index), now_ms, .destination_unreachable, true);
        return true;
    }
    pub fn dialDeferred(self: *Dialing, catalog: *Catalog, token: Token, now_ms: u64) bool {
        const attempt = self.attemptFor(token) orelse return false;
        if (attempt.connection != null) return false;
        const peer = attempt.peer.?;
        const row = catalog.edit(peer).?;
        self.retire(catalog, @intCast(token.index), .deferred, now_ms);
        row.dial.deferUntil(now_ms +| 1_000);
        releaseUnused(catalog, peer);
        return true;
    }
    fn retire(self: *Dialing, catalog: *Catalog, index: u8, outcome: t.DialOutcome, now_ms: u64) void {
        const attempt = &self.active[index];
        const peer = attempt.peer.?;
        const row = catalog.edit(peer).?;
        std.debug.assert(row.attempt == index);
        row.attempt = null;
        catalog.dial_schedule_dirty = true;
        self.held.total -= 1;
        if (attempt.connection == null) self.held.unstarted -= 1;
        self.durations[@intFromEnum(outcome)].observe(now_ms -| attempt.selected_ms);
        attempt.* = .{ .generation = attempt.generation };
        self.outcomes[@intFromEnum(outcome)] +|= 1;
    }
    fn failed(self: *Dialing, catalog: *Catalog, index: u8, now_ms: u64, failure: t.DialFailure, evidence: bool) void {
        const attempt = self.active[index];
        const peer = attempt.peer.?;
        const row = catalog.edit(peer).?;
        // Another connection to the peer already won, so this attempt is redundant, not failed.
        const redundant = row.connection != null;
        self.retire(catalog, index, if (redundant) .cancelled else failureOutcome(failure), now_ms);
        if (!redundant) {
            catalog.history.markRetry(dialedKey(catalog, row, &attempt), failure, now_ms);
            row.dial.dialFailed(now_ms, self.random.random().int(u16) % 1_001);
        }
        if (failure == .peer_id_mismatch) catalog.remembered.forgetEndpoint(&row.identity, attempt.address);
        // A redundant attempt leaves the backoff alone but still records its endpoint evidence.
        const learned = evidence and discoveryOnly(row);
        if (learned and remember(catalog, row, &attempt, failure, now_ms)) {
            row.dial.automatic = false;
        } else if (learned or !redundant) {
            rotate(catalog, row, &attempt, now_ms);
        }
        releaseUnused(catalog, peer);
    }
    /// Records the dialed endpoint's evidence and reports whether every endpoint of the intent is blocked.
    fn remember(catalog: *Catalog, row: *const Row, attempt: *const Attempt, failure: t.DialFailure, now_ms: u64) bool {
        std.debug.assert(discoveryOnly(row));
        const sequence = if (row.dial.hints) |hints| hints.sequence else 0;
        catalog.history.recordEndpoint(dialedKey(catalog, row, attempt), failure, sequence, now_ms);
        for (row.dial.addresses[0..row.dial.address_count]) |endpoint| {
            if (!catalog.history.blocked(catalog.history.endpointKey(&row.identity, endpoint), sequence, now_ms)) return false;
        }
        return true;
    }
    /// Moves past the dialed endpoint, or stays on the current one when a refresh replaced the dialed
    /// one. A discovery intent skips endpoints its history blocks, so it never returns to a
    /// peer-id-mismatched endpoint while another remains.
    fn rotate(catalog: *const Catalog, row: *Row, attempt: *const Attempt, now_ms: u64) void {
        const intent = &row.dial;
        std.debug.assert(intent.address_index < intent.address_count);
        var start = intent.address_index;
        for (intent.addresses[0..intent.address_count], 0..) |address, position| {
            if (address.eql(attempt.address)) start = @intCast((position + 1) % intent.address_count);
        }
        intent.address_index = start;
        if (!discoveryOnly(row)) return;
        const sequence = if (intent.hints) |hints| hints.sequence else 0;
        for (0..intent.address_count) |offset| {
            const position: u8 = @intCast((start + offset) % intent.address_count);
            if (!catalog.history.blocked(catalog.history.endpointKey(&row.identity, intent.addresses[position]), sequence, now_ms)) {
                intent.address_index = position;
                return;
            }
        }
    }
    fn releaseUnused(catalog: *Catalog, peer: t.PeerRef) void {
        const row = catalog.rowFor(peer).?;
        if (!row.direct and row.dial.manual_until_ms == 0 and row.attempt == null and
            (row.connection != null or !row.dial.automatic)) catalog.releaseIntent(peer);
    }
    /// Releases a completed or unused intent while preserving direct peers and live attempts.
    pub fn releaseIfUnused(catalog: *Catalog, peer: t.PeerRef) void {
        if (!catalog.intents.isSet(peer.index)) return;
        releaseUnused(catalog, peer);
    }
    /// Close the returned connections before delivering transport events or selecting more dials.
    pub fn expire(self: *Dialing, catalog: *Catalog, now_ms: u64, close: *[attempts_max]t.Handle) usize {
        var count: usize = 0;
        self.refresh(catalog, now_ms);
        if (self.manual_expiry_ms != null and now_ms >= self.manual_expiry_ms.?) {
            var it = catalog.intents.iterator(.{});
            while (it.next()) |index| {
                const row = &catalog.rows[index];
                if (row.dial.manual_until_ms == 0 or now_ms < row.dial.manual_until_ms) continue;
                const peer = catalog.reference(index);
                if (!row.dial.automatic and !row.direct) if (row.attempt) |slot| {
                    if (self.active[slot].connection) |conn| {
                        close[count] = conn;
                        count += 1;
                    }
                    self.retire(catalog, slot, .cancelled, now_ms);
                };
                row.dial.manual_until_ms = 0;
                catalog.intents_dirty = true;
                catalog.dial_schedule_dirty = true;
                releaseUnused(catalog, peer);
            }
        }
        for (self.active, 0..) |attempt, index| {
            if (attempt.peer == null or now_ms < attempt.lease_until_ms) continue;
            if (attempt.connection) |conn| {
                close[count] = conn;
                count += 1;
            }
            self.failed(catalog, @intCast(index), now_ms, .expired, false);
        }
        self.refresh(catalog, now_ms);
        return count;
    }
    /// Candidate scans follow policy changes or due eligibility, never unrelated network turns.
    pub fn refresh(self: *Dialing, catalog: *Catalog, now_ms: u64) void {
        if (!catalog.dial_schedule_dirty) return;
        self.next_eligible_ms = null;
        self.manual_expiry_ms = null;
        var it = catalog.intents.iterator(.{});
        while (it.next()) |index| self.includeDeadlines(catalog, &catalog.rows[index], now_ms);
        catalog.dial_schedule_dirty = false;
    }
    fn includeDeadlines(self: *Dialing, catalog: *const Catalog, row: *const Row, now_ms: u64) void {
        const expiry = row.dial.manual_until_ms;
        if (expiry != 0) self.manual_expiry_ms = @min(self.manual_expiry_ms orelse expiry, expiry);
        if (dialable(row, now_ms)) {
            const eligible = eligibleAt(catalog, row, now_ms);
            self.next_eligible_ms = @min(self.next_eligible_ms orelse eligible, eligible);
        }
    }
    fn freeAttempt(self: *const Dialing) ?u8 {
        for (self.active[0..self.options.concurrent_max], 0..) |attempt, index| {
            if (attempt.peer == null and attempt.generation != std.math.maxInt(u64)) return @intCast(index);
        }
        return null;
    }
    /// Starts attempts for the preferred eligible intents.
    /// Call `expire` and close its returned connections before selecting attempts at this time.
    pub fn poll(self: *Dialing, catalog: *Catalog, now_ms: u64, out: []SelectedDial) usize {
        self.refresh(catalog, now_ms);
        if (out.len == 0 or self.freeAttempt() == null) return 0;
        if (now_ms < (self.next_eligible_ms orelse return 0)) return 0;
        var indices: [candidates_max]u16 = undefined;
        var candidates: usize = 0;
        var it = catalog.intents.iterator(.{});
        while (it.next()) |index| {
            const row = &catalog.rows[index];
            if (!dialable(row, now_ms) or now_ms < eligibleAt(catalog, row, now_ms)) continue;
            indices[candidates] = @intCast(index);
            candidates += 1;
        }
        const pool = indices[0..candidates];
        var count: usize = 0;
        for (0..self.options.concurrent_max) |_| {
            if (count == out.len) break;
            const slot = self.freeAttempt() orelse break;
            var best: ?usize = null;
            var automatic: ?usize = null;
            for (pool) |index| {
                const row = &catalog.rows[index];
                if (row.attempt != null) continue;
                if (self.preferred(catalog, index, best, now_ms)) best = index;
                if (dialTier(row, now_ms) == 0 and self.preferred(catalog, index, automatic, now_ms)) automatic = index;
            }
            const index = (if (self.preferred_starts >= self.options.concurrent_max) automatic orelse best else best) orelse break;
            self.cursor = (index + 1) % catalog.rows.len;
            const row = catalog.edit(catalog.reference(index)).?;
            const attempt = &self.active[slot];
            attempt.* = .{ .generation = attempt.generation + 1, .selected_ms = now_ms, .peer = catalog.reference(index), .lease_until_ms = if (row.direct or row.dial.automatic) now_ms +| 10_000 else @min(row.dial.manual_until_ms, now_ms +| 10_000), .address = row.dial.addresses[row.dial.address_index] };
            row.attempt = slot;
            self.held.total += 1;
            self.held.unstarted += 1;
            const tier = dialTier(row, now_ms);
            self.preferred_starts = if (tier == 0) 0 else @min(self.preferred_starts + 1, self.options.concurrent_max);
            self.selected_attempts[tier] +|= 1;
            if (discoveryOnly(row)) catalog.remembered.note(row.dial.origin, .dialed);
            if (catalog.history.takeRetry(dialedKey(catalog, row, attempt), now_ms)) |failure| self.retries[@intFromEnum(failure)] +|= 1;
            out[count] = .{ .token = .{ .index = slot, .generation = attempt.generation }, .peer = row.identity, .address = attempt.address };
            count += 1;
        }
        catalog.dial_schedule_dirty = true;
        self.refresh(catalog, now_ms);
        return count;
    }
    fn preferred(self: *const Dialing, catalog: *const Catalog, index: usize, current: ?usize, now_ms: u64) bool {
        const best = current orelse return true;
        const row = &catalog.rows[index];
        const other = &catalog.rows[best];
        if (dialTier(row, now_ms) != dialTier(other, now_ms)) return dialTier(row, now_ms) > dialTier(other, now_ms);
        if (row.dial.priority != other.dial.priority) return row.dial.priority > other.dial.priority;
        if (row.dial.failures != other.dial.failures) return row.dial.failures < other.dial.failures;
        return (index + catalog.rows.len - self.cursor) % catalog.rows.len < (best + catalog.rows.len - self.cursor) % catalog.rows.len;
    }
    /// Only a live manual intent dials through the identity's rejection block; discovery and direct
    /// retries wait for it.
    fn eligibleAt(catalog: *const Catalog, row: *const Row, now_ms: u64) u64 {
        var rep = row.reputation;
        rep.decay(now_ms);
        var due = @max(row.dial.eligible_at_ms, rep.goodbye_until_ms);
        if (rep.banned(now_ms)) due = @max(due, rep.nextDeadline(now_ms) orelse std.math.maxInt(u64));
        if (dialTier(row, now_ms) == 0) due = @max(due, rep.redial_until_ms);
        if (now_ms >= row.dial.manual_until_ms) due = @max(due, catalog.history.rejectedUntil(catalog.history.identityKey(&row.identity), now_ms));
        return due;
    }
    pub fn schedule(self: *const Dialing, catalog: *const Catalog, output_capacity: usize) Schedule {
        var result: Schedule = .{
            .runnable = catalog.dial_schedule_dirty,
            .deadline = time.optionalMilliseconds(self.manual_expiry_ms),
        };
        for (self.active) |attempt| if (attempt.peer != null) {
            result = result.merge(.{ .deadline = time.milliseconds(attempt.lease_until_ms) });
        };
        if (output_capacity != 0 and self.freeAttempt() != null)
            result = result.merge(.{ .deadline = time.optionalMilliseconds(self.next_eligible_ms) });
        return result;
    }
    pub fn shutdown(self: *Dialing, catalog: *Catalog, now_ms: u64, close: *[attempts_max]t.Handle) usize {
        var count: usize = 0;
        for (self.active, 0..) |attempt, index| {
            if (attempt.peer == null) continue;
            if (attempt.connection) |conn| {
                close[count] = conn;
                count += 1;
            }
            self.retire(catalog, @intCast(index), .cancelled, now_ms);
        }
        var it = catalog.intents.iterator(.{});
        while (it.next()) |index| {
            const peer = catalog.reference(index);
            _ = catalog.setDirect(peer, false);
            catalog.releaseIntent(peer);
        }
        return count;
    }
};
fn closeFailure(reason: t.CloseReason) t.DialFailure {
    return switch (reason) {
        .dial_unanswered => .unanswered,
        .handshake_timeout => .handshake_timeout,
        .peer_id_mismatch => .peer_id_mismatch,
        else => .refused,
    };
}
fn failureOutcome(failure: t.DialFailure) t.DialOutcome {
    return switch (failure) {
        // A health close follows an admitted connection, whose attempt already retired as connected.
        .health => unreachable,
        inline else => |tag| @field(t.DialOutcome, @tagName(tag)),
    };
}
fn dialTier(row: *const Row, now_ms: u64) u8 {
    return if (row.direct) 2 else if (now_ms < row.dial.manual_until_ms) 1 else 0;
}
fn hasDialIntent(row: *const Row, now_ms: u64) bool {
    return row.direct or now_ms < row.dial.manual_until_ms or (row.dial.automatic and row.dial.selected);
}
/// An intent row the dialer may start an attempt for once it is eligible.
fn dialable(row: *const Row, now_ms: u64) bool {
    return row.connection == null and row.attempt == null and hasDialIntent(row, now_ms);
}
/// Only discovery-only intents record and consult endpoint history.
fn discoveryOnly(row: *const Row) bool {
    return row.dial.automatic and !row.direct and row.dial.manual_until_ms == 0;
}
fn dialedKey(catalog: *const Catalog, row: *const Row, attempt: *const Attempt) u64 {
    return catalog.history.endpointKey(&row.identity, attempt.address);
}

// IPv4 /24 and IPv6 /48 guide replacement, not admission entitlements: an ENR proves no endpoint ownership.
fn candidatePrefix(address: t.Address) u64 {
    const canonical = t.Address.fromNetwork(address.toNetwork());
    return switch (canonical) {
        .ip4 => |ip| @as(u64, 4) << 56 | (std.mem.readInt(u32, &ip.octets, .big) >> 8),
        .ip6 => |ip| @as(u64, 6) << 56 | std.mem.readInt(u48, ip.octets[0..6], .big),
    };
}

fn comparePrefix(prefix: u64, other: u64) std.math.Order {
    return std.math.order(prefix, other);
}

fn prefixPopulation(sorted: []const u64, dial: *const Catalog.DialState) usize {
    var population: usize = 0;
    for (dial.addresses[0..dial.address_count]) |address| {
        const prefix = candidatePrefix(address);
        const count = std.sort.upperBound(u64, sorted, prefix, comparePrefix) - std.sort.lowerBound(u64, sorted, prefix, comparePrefix);
        population = @max(population, count);
    }
    return population;
}

const Admitted = struct { addresses: [2]t.Address = undefined, count: u8 = 0, strikes: u8 = 0, rejection: ?t.Rejection = null };

/// The candidate's endpoints its dial history admits: none while the identity's rejection blocks
/// it, else those without a blocking failure. A remembered candidate has no ENR sequence, 0, so no
/// newer record lifts a block.
fn admittedAddresses(catalog: *const Catalog, peer: *const t.PeerId, addresses: []const t.Address, sequence: u64, now_ms: u64) Admitted {
    std.debug.assert(addresses.len <= 2);
    var result: Admitted = .{ .rejection = catalog.history.rejection(catalog.history.identityKey(peer), now_ms) };
    if (result.rejection != null) return result;
    for (addresses) |address| {
        if (result.count != 0 and result.addresses[0].eql(address)) continue;
        const key = catalog.history.endpointKey(peer, address);
        if (catalog.history.blocked(key, sequence, now_ms)) continue;
        result.strikes = @max(result.strikes, catalog.history.strikesFor(key, sequence, now_ms));
        result.addresses[result.count] = address;
        result.count += 1;
    }
    return result;
}

fn applyAddresses(state: *Catalog.DialState, admitted: *const Admitted) void {
    state.addresses = admitted.addresses;
    state.address_count = admitted.count;
    state.address_index = 0;
    state.failures = @max(state.failures, admitted.strikes);
}

/// Local closes say nothing about the dialed endpoint; their attempts still count once by outcome.
fn endpointEvidence(reason: t.CloseReason) bool {
    return switch (reason) {
        .host, .send_failed => false,
        .idle_timeout, .handshake_timeout, .dial_unanswered, .peer_id_mismatch, .tls_failed, .peer_closed, .transport_error => true,
    };
}

comptime {
    std.debug.assert(Dialing.attempts_max <= std.math.maxInt(u8));
}

test {
    _ = @import("dialing_test.zig");
    _ = @import("dialing_catalog_test.zig");
    _ = @import("dialing_candidates_test.zig");
    _ = @import("dialing_custody_test.zig");
    _ = @import("dialing_history_test.zig");
    _ = @import("dialing_metrics_test.zig");
    _ = @import("dialing_replay_test.zig");
    _ = @import("dialing_enr_test.zig");
}
