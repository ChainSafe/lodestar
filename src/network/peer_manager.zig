const std = @import("std");
const time = @import("time.zig");
const capabilities = @import("capabilities.zig");
const t = @import("peers/types.zig");
const peers = @import("peers/root.zig");
const policy = peers.policy;
const Engine = @import("quic/Engine.zig");
const gossip = @import("gossipsub/root.zig");
const Now = @import("types.zig").Now;
const coverage = @import("peers/coverage.zig");
const local_state = @import("local_state.zig");
const logging = @import("logging.zig");
const ReqResp = @import("reqresp/root.zig").ReqResp;
const types = @import("types.zig");

pub const policy_interval_ms = 1_000;
pub const replacement_interval_ms = 5_000;

pub const Options = struct {
    peers: peers.Catalog.Options = .{},
    control: peers.Control.Options = .{},
    dial: peers.Dialing.Options,
    metadata_freshness_ms: u64 = 60_000,
};
pub const SelectedDial = peers.Dialing.SelectedDial;
pub const DiscoveryNeed = struct {
    general: bool = false,
    attnets: [8]u8 = @splat(0),
    syncnets: u8 = 0,
    custody: bool = false,

    /// Query lifetime bounds discovery work independently of the desired peer coverage.
    pub fn query(self: DiscoveryNeed) peers.Discovery.Demand {
        return .{ .general = self.general, .attnets = self.attnets, .syncnets = self.syncnets, .custody = self.custody };
    }
};

pub const PeerManager = struct {
    allocator: std.mem.Allocator,
    catalog: peers.Catalog,
    control: peers.Control,
    dialing: peers.Dialing,
    local_identity: t.PeerId,
    local: t.LocalState,
    snapshot_scratch: []t.Snapshot,
    policy_scratch: []policy.Input,
    selection: policy.Result = .{},
    discovery_need: DiscoveryNeed = .{},
    demand: t.Demand = .{},
    custody_pending: bool = false,
    selection_deadline: ?u64 = null,
    policy_due_ms: u64 = 0,
    replacement_after_ms: u64 = 0,
    native_dial_room: u16 = 0,
    metadata_freshness_ms: u64,
    policy_seed: u64,
    phase: Phase = .running,
    counters: Counters = .{},

    pub const Phase = enum { running, quiescing, stopped };

    pub const Counters = struct {
        custody_hashes: u64 = 0,
        candidate_selections: u64 = 0,
    };
    pub const PeerCounts = struct { connected: u16, relevant: u16, outbound_relevant: u16 };
    pub const Capacities = struct { peers: usize, dials: usize };
    pub const Admission = struct { peer: t.PeerRef, displaced: ?t.Handle, direct: bool };

    pub fn validateOptions(options: Options) !void {
        try options.peers.validate();
        if (options.peers.target_peers >= options.peers.max_peers or
            options.dial.outbound_reserved > options.peers.max_peers - options.peers.target_peers) return error.InvalidOptions;
        if (options.metadata_freshness_ms == 0 or options.metadata_freshness_ms > 86_400_000) return error.InvalidOptions;
        try peers.Control.validateOptions(options.control);
        try peers.Dialing.validateOptions(options.dial);
    }

    pub fn init(
        a: std.mem.Allocator,
        identity: *const t.PeerId,
        local: *const t.LocalState,
        options: Options,
        receive: capabilities.Set,
        connections: u16,
    ) !PeerManager {
        var copied: t.LocalState = undefined;
        try local_state.copyServingLocal(&copied, local, receive);
        try validateOptions(options);
        var catalog = try peers.Catalog.initWithIntents(a, options.peers, options.dial.capacity, connections, options.dial.seed);
        errdefer catalog.deinit(a);
        var control = try peers.Control.init(a, options.control, @intCast(catalog.rows.len));
        errdefer control.deinit(a);
        const dialing = try peers.Dialing.init(options.dial);
        const scratch = try a.alloc(t.Snapshot, options.peers.capacity);
        errdefer a.free(scratch);
        const policy_scratch = try a.alloc(policy.Input, options.peers.max_peers);
        errdefer a.free(policy_scratch);
        return .{
            .allocator = a,
            .catalog = catalog,
            .control = control,
            .dialing = dialing,
            .local_identity = identity.*,
            .local = copied,
            .snapshot_scratch = scratch,
            .policy_scratch = policy_scratch,
            .metadata_freshness_ms = options.metadata_freshness_ms,
            .policy_seed = options.dial.seed,
        };
    }
    /// The owner closes every connection before releasing an active PeerManager.
    pub fn deinit(self: *PeerManager) void {
        self.allocator.free(self.policy_scratch);
        self.allocator.free(self.snapshot_scratch);
        self.control.deinit(self.allocator);
        self.catalog.deinit(self.allocator);
        self.* = undefined;
    }
    /// Admits an authenticated connection and starts qualification, abandoning displaced control
    /// requests before reusing their row. The owner releases the displaced connection's transport
    /// and other protocols after this returns. Call outside a borrowed reqresp event batch.
    pub fn admit(
        self: *PeerManager,
        event: *const @FieldType(Engine.Event, "connected"),
        endpoint: t.Address,
        io: *const peers.Control.Io,
        now: Now,
    ) ?Admission {
        if (self.phase != .running) return null;
        const identity = event.peer_id;
        const decision = self.catalog.admit(
            &identity,
            &self.local_identity,
            event.conn,
            &.{
                .direction = event.direction,
                .endpoint = endpoint,
                .now_ms = now.millis(),
                .outbound_reserved = self.dialing.options.outbound_reserved,
                .pending_dials = self.dialing.answeredPeers(&self.catalog, &identity),
                .selected_dial = self.dialing.selectedPeer(&self.catalog, &identity, now.millis()),
            },
        );
        switch (decision) {
            .admitted => |admission| {
                const fault = if (admission.displaced) |old|
                    self.control.releaseConnection(io, admission.peer, old, now)
                else
                    null;
                self.control.connected(&self.catalog, admission.peer, event.conn, event.direction, now);
                if (fault) |*value| self.requestFault(value, now);
                self.dialing.accepted(&self.catalog, admission.peer, event.conn, now.millis());
                return .{
                    .peer = admission.peer,
                    .displaced = admission.displaced,
                    .direct = self.catalog.rowFor(admission.peer).?.direct,
                };
            },
            else => {
                std.log.scoped(.network_peers).debug("peer_admission_refused peer={f} connection={d}:{d} reason={s}", .{ logging.peer(&identity), event.conn.index, event.conn.generation, @tagName(decision) });
                _ = self.dialing.deferConnection(&self.catalog, event.conn, now.millis());
                return null;
            },
        }
    }
    /// Stops selecting new work once, while the core releases existing I/O.
    pub fn stop(self: *PeerManager) bool {
        if (self.phase == .stopped) return false;
        self.phase = .stopped;
        self.selection = .{};
        self.discovery_need = .{};
        return true;
    }
    /// Stops application demand while preserving control progress for graceful Goodbye.
    pub fn quiesce(self: *PeerManager, now: Now) bool {
        if (self.phase != .running) return false;
        self.phase = .quiescing;
        self.selection = .{};
        self.discovery_need = .{};
        for (self.catalog.rows, 0..) |row, index| {
            if (!row.occupied or row.connection == null) continue;
            _ = self.disconnect(.{ .index = @intCast(index), .generation = row.generation }, .shutdown, now);
        }
        return true;
    }
    pub const Retired = struct { peer: t.PeerRef, conn: t.Handle };
    /// Settles an ended dial and connection once. Preserve remote evidence before retirement
    /// releases Status, Metadata and dial state. The caller then cancels protocol/gossip I/O.
    pub fn transportClosed(self: *PeerManager, closed: *const @FieldType(Engine.Event, "closed"), goodbye: ?u64, now: Now) ?Retired {
        _ = self.dialing.dialClosed(&self.catalog, closed.conn, closed.reason, now.millis());
        const peer = self.catalog.findConnection(closed.conn) orelse return null;
        if (goodbye) |code| self.control.receivedGoodbye(&self.catalog, peer, closed.conn, code, true);
        if (closed.reason == .peer_closed) self.control.remoteClosed(peer, closed.conn);
        const row = self.catalog.rowFor(peer).?;
        const reason = row.closing_reason orelse if (goodbye != null) t.DisconnectReason.remote_goodbye else .transport_closed;
        return self.retireConnection(peer, closed.conn, reason, now);
    }
    /// Completes policy retirement before returning the connection whose I/O the caller releases.
    /// Duplicate and stale generations have no effect. Evidence is settled before catalog clearing.
    pub fn retireConnection(self: *PeerManager, peer: t.PeerRef, conn: t.Handle, reason: t.DisconnectReason, now: Now) ?Retired {
        const current = self.catalog.findConnection(conn) orelse return null;
        if (!std.meta.eql(current, peer)) return null;
        const evidence = self.control.close(peer, conn, reason) orelse return null;
        const disconnected = self.catalog.disconnect(peer, conn, reason, evidence, now);
        std.debug.assert(disconnected);
        return .{ .peer = peer, .conn = conn };
    }
    /// After stop, retires connections in catalog order. Start the cursor at zero; the caller
    /// releases each returned connection's I/O before continuing.
    pub fn retireNextConnection(self: *PeerManager, cursor: *usize, now: Now) ?Retired {
        std.debug.assert(self.phase == .stopped);
        while (cursor.* < self.catalog.rows.len) {
            const index = cursor.*;
            cursor.* += 1;
            const row = &self.catalog.rows[index];
            if (!row.occupied) continue;
            const conn = row.connection orelse continue;
            if (self.retireConnection(self.catalog.reference(index), conn, .shutdown, now)) |retired| return retired;
        }
        return null;
    }
    pub fn endpointChanged(self: *PeerManager, conn: t.Handle, endpoint: *const t.Address, now: Now) ?Retired {
        const peer = self.catalog.findConnection(conn) orelse return null;
        _ = self.catalog.updateEndpoint(peer, conn, endpoint) catch {
            return self.retireConnection(peer, conn, .capacity, now);
        };
        return null;
    }
    /// Catalog and delivery changes apply immediately. Scores and subscriptions refresh at most
    /// one policy interval after a change; protocol and metadata deadlines may wake selection sooner.
    pub fn reconcile(self: *PeerManager, gossipsub: *gossip.Gossipsub, now: Now) void {
        if (self.phase != .running) return;
        self.catalog.advanceClock(now.millis());
        if (self.policySchedule(gossipsub).due(now.monotonic)) {
            self.refreshSelection(gossipsub, now);
            self.refreshDiscoveryNeed();
            self.catalog.selection_dirty = false;
            gossipsub.clearDeliveryChanged();
            self.policy_due_ms = now.millis() +| policy_interval_ms;
            self.catalog.intents_dirty = true;
        }
        if (self.discovery_need.general) _ = peers.Dialing.replayRemembered(&self.catalog, &self.local.fork, &self.selection.deficits.missing, now);
        if (self.catalog.intents_dirty or (if (self.dialing.selection_deadline) |due| now.millis() >= due else false)) {
            self.counters.candidate_selections +|= 1;
            self.dialing.configureSelection(&self.catalog, &self.selection.deficits.missing, self.selection.qualified_count < self.catalog.options.target_peers or self.selection.deficits.outbound > 0, &self.local.fork, now.millis());
        }
    }
    fn policySchedule(self: *const PeerManager, gossipsub: *const gossip.Gossipsub) types.Schedule {
        return .{
            .runnable = self.catalog.selection_dirty or gossipsub.deliveryChanged(),
            .deadline = time.milliseconds(@min(self.policy_due_ms, self.selection_deadline orelse self.policy_due_ms)),
        };
    }
    /// Observes transport progress before admission or dial selection. Admission itself consumes
    /// these bounded facts without borrowing transport or executing I/O.
    pub fn transportProgress(self: *PeerManager, engine: *const Engine) void {
        self.dialing.syncAnswered(engine);
        self.native_dial_room = engine.limits.connections_max -| engine.resourceSnapshot().active;
    }

    /// Observes scheduling without applying pending work. Recompute after owner mutation.
    pub fn schedule(self: *const PeerManager, gossipsub: *const gossip.Gossipsub, now: Now, capacities: Capacities) types.Schedule {
        std.debug.assert(self.phase != .stopped);
        var result: types.Schedule = .{};
        result = result.merge(.{ .runnable = capacities.peers > 0 and self.catalog.eventsPending() });
        result = result.merge(self.control.schedule(&self.catalog, now));
        if (self.phase != .running) return result;
        result = result.merge(self.dialing.schedule(&self.catalog, @min(capacities.dials, self.dialRoom())));
        result = result.merge(.{ .runnable = self.catalog.intents_dirty, .deadline = time.optionalMilliseconds(self.dialing.selection_deadline) });
        result = result.merge(self.policySchedule(gossipsub));
        result = result.merge(.{ .deadline = time.optionalMilliseconds(if (self.custody_pending) now.millis() +| 1 else null) });
        return result;
    }
    /// Requires demand validated against the local fork before publication.
    pub fn commitDemand(self: *PeerManager, demand: *const t.Demand) void {
        self.demand = demand.*;
        self.catalog.selection_dirty = true;
    }
    /// Returns the last completed policy evaluation, shared with discoveryNeed.
    /// Call reconcile with an explicit clock to include pending input changes.
    pub fn coverageDeficits(self: *const PeerManager) policy.Deficits {
        return self.selection.deficits;
    }
    /// Returns the same completed evaluation as coverageDeficits without advancing policy.
    pub fn discoveryNeed(self: *const PeerManager) DiscoveryNeed {
        return self.discovery_need;
    }
    pub const DiscoveryIntake = struct { accepted: u16 = 0, refused: u16 = 0 };
    /// Requires Discovery.step output or equivalent authenticated-source scope authorization.
    pub fn discoveredBatch(self: *PeerManager, gossipsub: *gossip.Gossipsub, candidates: []const peers.enr.Candidate, now: Now) DiscoveryIntake {
        std.debug.assert(candidates.len <= peers.Discovery.candidates_per_step);
        self.reconcile(gossipsub, now);
        var result: DiscoveryIntake = .{};
        for (candidates) |*candidate| {
            self.enqueueDiscovered(candidate, now) catch {
                result.refused += 1;
                continue;
            };
            result.accepted += 1;
        }
        return result;
    }
    fn enqueueDiscovered(self: *PeerManager, candidate: *const peers.enr.Candidate, now: Now) !void {
        if (self.phase != .running) return error.Stopped;
        if (candidate.peer.eql(&self.local_identity)) return error.SelfDial;
        try self.dialing.enqueueDiscovered(&self.catalog, candidate, &self.local.fork, &self.selection.deficits.missing, now.millis());
    }
    fn refreshSelection(self: *PeerManager, gossipsub: *gossip.Gossipsub, now: Now) void {
        self.selection_deadline = null;
        const count = self.catalog.snapshots(self.snapshot_scratch);
        const local_subscriptions = gossipsub.localSubscriptions(self.local.fork.digest);
        var input_count: usize = 0;
        for (self.snapshot_scratch[0..count]) |*snapshot| {
            const conn = snapshot.connection orelse continue;
            if (snapshot.disconnect_reason != null) continue;
            std.debug.assert(input_count < self.policy_scratch.len);
            const input = &self.policy_scratch[input_count];
            input_count += 1;
            input.* = self.selectionInput(gossipsub, snapshot, conn, &local_subscriptions, now);
            const grace = snapshot.connected_at_ms +| self.control.options.inbound_status_grace_ms;
            if (input.reject == null and now.millis() < grace) {
                input.evaluating = true;
                self.selection_deadline = @min(self.selection_deadline orelse grace, grace);
            }
        }
        self.selection = policy.selectWithPacing(self.policy_scratch[0..input_count], &self.demand, self.catalog.options, self.policy_seed, now.millis() >= self.replacement_after_ms);
        for (self.policy_scratch[0..input_count], 0..) |input, i| if (self.selection.reasons[i]) |reason| {
            _ = self.disconnect(input.peer, reason, now);
            if (reason == .count_pruning) self.replacement_after_ms = now.millis() +| replacement_interval_ms;
        };
        if (now.millis() < self.replacement_after_ms) {
            // Pruning can start the cooldown after selection computed its dial budget.
            const refill = @max(self.catalog.options.target_peers -| self.selection.qualified_count, self.selection.deficits.outbound);
            self.selection.dial_budget = @min(self.selection.dial_budget, refill);
            self.selection_deadline = @min(self.selection_deadline orelse self.replacement_after_ms, self.replacement_after_ms);
        }
    }

    fn selectionInput(
        self: *PeerManager,
        gossipsub: *gossip.Gossipsub,
        snapshot: *const t.Snapshot,
        conn: t.Handle,
        local_subscriptions: *const gossip.topic_policy.Subnets,
        now: Now,
    ) policy.Input {
        const revalidation = self.control.revalidationDeadline(snapshot.peer, conn, now);
        const gossip_score = self.gossipScore(gossipsub, snapshot.peer, now) orelse 0;
        var input: policy.Input = .{
            .peer = snapshot.peer,
            .connected_at_ms = snapshot.connected_at_ms,
            .direct = snapshot.direct,
            .outbound = snapshot.direction == .outbound,
            .qualified = (snapshot.status != null or revalidation != null) and snapshot.metadata != null,
            .revalidating = revalidation != null,
            .ready = false,
            .score = peers.reputation.selectionScore(
                snapshot.score,
                gossip_score,
                gossipsub.graylistThreshold(),
            ),
        };
        if (snapshot.ban_until_ms > now.millis() or snapshot.score <= peers.reputation.ban_score)
            input.reject = .banned;
        if (snapshot.status) |status| {
            if (!std.mem.eql(u8, &status.fork_digest, &self.local.fork.digest))
                input.reject = .incompatible_fork;
            if (self.local.fork.fork.gte(.fulu) and status.earliest_available_slot == null)
                input.reject = .missing_availability;
        }
        const delivery = gossipsub.deliveryStatus(conn);
        if (delivery == .send_timeout and input.reject == null) input.reject = .gossip_send_timeout;
        if (delivery == .unavailable) {
            if (!input.revalidating) input.outbound = false;
            if (snapshot.relevant and !snapshot.direct and input.reject == null)
                input.reject = .gossip_unavailable;
        }
        if (revalidation) |deadline|
            self.selection_deadline = @min(self.selection_deadline orelse deadline, deadline);
        if ((!snapshot.relevant and !input.revalidating) or input.reject != null) return input;
        const subscriptions = gossipsub.coverageSubscriptions(conn, self.local.fork.digest, local_subscriptions, now);
        input.coverage = coverage.gossip(&subscriptions, &self.local.fork);
        const metadata = snapshot.metadata orelse return input;
        local_state.validateMetadata(&metadata, self.local.fork) catch return input;
        const deadline = snapshot.metadata_at_ms +| self.metadata_freshness_ms;
        if (now.millis() >= deadline) return input;
        self.selection_deadline = @min(self.selection_deadline orelse deadline, deadline);
        if (delivery == .available) {
            input.ready = !self.local.fork.fork.gte(.fulu) or snapshot.sampling_groups != null;
            input.stable = coverage.stable(&input.coverage, &metadata, snapshot.sampling_groups);
        }
        if (self.local.fork.fork.gte(.fulu) and snapshot.score >= peers.reputation.prune_score)
            input.coverage.custody_groups = snapshot.custody_groups orelse .empty;
        return input;
    }
    fn refreshDiscoveryNeed(self: *PeerManager) void {
        self.discovery_need = .{};
        self.discovery_need.general = self.selection.qualified_count < self.catalog.options.target_peers or
            self.selection.deficits.outbound > 0;
        std.mem.writeInt(u64, &self.discovery_need.attnets, self.selection.deficits.missing.attnets, .little);
        self.discovery_need.syncnets = self.selection.deficits.missing.syncnets;
        self.discovery_need.custody = self.selection.deficits.groups > 0 or self.selection.deficits.custody_groups > 0;
    }
    fn dialRoom(self: *const PeerManager) u16 {
        const attempts = self.dialing.attempts();
        const pending = self.dialing.pendingPeers(&self.catalog, null);
        const capacity = self.catalog.options.max_peers -| self.catalog.connectedCount() -| pending;
        const wanted = @max(self.selection.dial_budget, self.dialing.host_demand) -| pending;
        return @min(self.native_dial_room -| attempts.unstarted, capacity, wanted);
    }
    /// Replaces the local Status alone, validated for the protocols the node serves.
    pub fn updateStatus(self: *PeerManager, receive: capabilities.Set, status: *const t.Status) !void {
        var local = self.local;
        local.status = status.*;
        try local_state.copyServingLocal(&self.local, &local, receive);
        self.catalog.selection_dirty = true;
    }

    /// Applies peer policy's consequences of a committed local state. The caller validates it and
    /// the demand that holds under it, and revalidates control connection states first when the fork changes.
    pub fn commitLocal(self: *PeerManager, local: *const t.LocalState, now: Now) void {
        self.local = local.*;
        var budget: u16 = 0;
        _ = self.catalog.advanceCustody(&self.local.fork, now.millis(), self.metadata_freshness_ms, &budget);
        self.catalog.selection_dirty = true;
    }
    pub fn reStatusPeer(self: *PeerManager, peer: t.PeerRef, connection: t.Handle, now: Now) bool {
        if (self.phase == .stopped) return false;
        return self.control.reStatusPeer(&self.catalog, peer, connection, now);
    }
    pub fn reStatusPeers(self: *PeerManager, now: Now) void {
        self.control.reStatusPeers(&self.catalog, now);
    }
    pub fn requestFault(self: *PeerManager, fault: *const ReqResp.PeerFault, now: Now) void {
        switch (fault.kind) {
            .protocol => _ = self.reportPeer(&.{ .identity = fault.identity, .origin = fault.origin, .action = .low_tolerance, .reason = .reqresp_protocol }, now),
            .non_completion => {
                std.log.scoped(.network_peers).debug("peer_non_completion peer={f} connection={d}:{d} endpoint={any}", .{ logging.peer(&fault.identity), fault.origin.connection.index, fault.origin.connection.generation, fault.origin.endpoint });
                const peer = self.catalog.find(&fault.identity) orelse return;
                _ = self.catalog.nonCompletion(peer, now.millis());
                self.catalog.selection_dirty = true;
            },
        }
    }
    /// Identity reputation may outlive a connection. Endpoint evidence always stays with
    /// the original observation, including when the catalog has forgotten that identity.
    pub fn reportPeer(self: *PeerManager, report: *const t.PeerReport, now: Now) ?t.ReputationDecision {
        std.log.scoped(.network_peers).debug("peer_report peer={f} action={s} reason={s} origin={any}", .{ logging.peer(&report.identity), @tagName(report.action), @tagName(report.reason), report.origin });
        const peer = self.catalog.find(&report.identity) orelse return null;
        const decision = self.catalog.report(peer, report.action, now.millis()) orelse return null;
        self.catalog.selection_dirty = true;
        if (decision != .none) _ = self.disconnect(
            peer,
            if (decision == .ban) .banned else .reputation,
            now,
        );
        return decision;
    }
    pub fn connect(
        self: *PeerManager,
        identity: *const t.PeerId,
        addresses: []const t.Address,
        now: Now,
    ) !void {
        return self.connectUntil(identity, addresses, now, now.millis() +| peers.Dialing.connect_timeout_ms);
    }
    pub fn connectUntil(self: *PeerManager, identity: *const t.PeerId, addresses: []const t.Address, now: Now, deadline_ms: u64) !void {
        if (self.phase != .running) return error.Stopped;
        if (identity.eql(&self.local_identity)) return error.SelfDial;
        try self.dialing.enqueueUntil(&self.catalog, identity, addresses, false, now.millis(), deadline_ms);
        self.catalog.selection_dirty = true;
    }
    /// Retires dial ownership before returning the connection for the owner to close or abandon.
    pub fn cancelConnect(self: *PeerManager, identity: *const t.PeerId, now: Now) ?t.Handle {
        const close = self.dialing.cancelConnect(&self.catalog, identity, now.millis());
        self.catalog.selection_dirty = true;
        return close;
    }
    pub fn expireDials(self: *PeerManager, now: Now, close: *[peers.Dialing.attempts_max]t.Handle) []const t.Handle {
        const count = self.dialing.expire(&self.catalog, now.millis(), close);
        return close[0..count];
    }
    pub fn shutdownDials(self: *PeerManager, now: Now, close: *[peers.Dialing.attempts_max]t.Handle) []const t.Handle {
        const count = self.dialing.shutdown(&self.catalog, now.millis(), close);
        return close[0..count];
    }
    pub fn advanceCustody(self: *PeerManager, now: Now) void {
        var budget: u16 = peers.custody.hashes_per_turn;
        self.custody_pending = self.catalog.advanceCustody(&self.local.fork, now.millis(), self.metadata_freshness_ms, &budget);
        self.counters.custody_hashes +|= peers.custody.hashes_per_turn - budget;
    }
    /// Returns the peer's current connection, which the owner marks direct in gossip.
    pub fn addDirectPeer(
        self: *PeerManager,
        identity: *const t.PeerId,
        addresses: []const t.Address,
        now: Now,
    ) !?t.Handle {
        if (self.phase != .running) return error.Stopped;
        if (identity.eql(&self.local_identity)) return error.SelfDial;
        const already_direct = if (self.catalog.find(identity)) |peer| self.catalog.rowFor(peer).?.direct else false;
        if (!already_direct and self.catalog.direct_count >= self.catalog.options.target_peers - self.catalog.options.min_outbound)
            return error.DirectPeerCapacity;
        try self.dialing.enqueue(&self.catalog, identity, addresses, true, now.millis());
        self.catalog.selection_dirty = true;
        const peer = self.catalog.find(identity) orelse return null;
        _ = self.catalog.setDirect(peer, true);
        return self.catalog.rowFor(peer).?.connection;
    }
    pub fn directPeers(self: *const PeerManager, out: []t.PeerId) error{OutputTooSmall}!usize {
        return self.catalog.directPeers(out);
    }
    /// The owner unmarks the peer in gossip when this returns true.
    pub fn removeDirectPeer(self: *PeerManager, identity: *const t.PeerId) bool {
        const peer = self.catalog.find(identity) orelse return false;
        if (!self.catalog.rowFor(peer).?.direct) return false;
        _ = self.catalog.setDirect(peer, false);
        peers.Dialing.releaseIfUnused(&self.catalog, peer);
        self.catalog.selection_dirty = true;
        return true;
    }
    pub fn disconnect(self: *PeerManager, peer: t.PeerRef, reason: t.DisconnectReason, now: Now) bool {
        const snapshot = self.catalog.rowFor(peer) orelse return false;
        return self.control.disconnect(
            &self.catalog,
            peer,
            snapshot.connection orelse return false,
            reason,
            now,
        ) != null;
    }
    /// Run `expireDials` before admitting transport events and selecting dials at this time.
    pub fn selectDials(
        self: *PeerManager,
        gossipsub: *gossip.Gossipsub,
        engine: *const Engine,
        now: Now,
        out: []peers.Dialing.SelectedDial,
    ) usize {
        if (self.phase != .running) return 0;
        self.reconcile(gossipsub, now);
        self.transportProgress(engine);
        const count = self.dialing.poll(&self.catalog, now.millis(), out[0..@min(out.len, self.dialRoom())]);
        if (count > 0 and self.selection.qualified_count >= self.catalog.options.target_peers and self.selection.deficits.outbound == 0) {
            self.replacement_after_ms = now.millis() +| replacement_interval_ms;
            self.catalog.selection_dirty = true;
        }
        return count;
    }
    pub fn dialStarted(self: *PeerManager, token: peers.Dialing.Token, conn: t.Handle) bool {
        return self.dialing.dialStarted(token, conn);
    }
    pub fn dialDeferred(self: *PeerManager, token: peers.Dialing.Token, now: Now) bool {
        return self.dialing.dialDeferred(&self.catalog, token, now.millis());
    }
    pub fn dialFailed(self: *PeerManager, token: peers.Dialing.Token, now: Now) bool {
        return self.dialing.dialFailed(&self.catalog, token, now.millis());
    }
    /// Call after reporting every selected dial as started, deferred or failed.
    pub fn finishDialBatch(self: *PeerManager, now: Now) void {
        std.debug.assert(self.dialing.attempts().unstarted == 0);
        self.dialing.refresh(&self.catalog, now.millis());
    }
    pub fn pollEvents(self: *PeerManager, out: []t.Event) usize {
        return self.catalog.pollEvents(out);
    }
    pub fn snapshots(self: *const PeerManager, out: []t.Snapshot) usize {
        return self.catalog.snapshots(out);
    }
    /// Loads the host's remembered peers once at startup, for replay under general demand.
    pub fn loadRemembered(self: *PeerManager, records: []const peers.remembered.Record, now: Now) void {
        const memory = &self.catalog.remembered;
        memory.load(records, &self.local_identity, peers.remembered.seconds(now), self.catalog.random.random());
        const seeds = &memory.counters.seeds;
        const Seed = peers.remembered.Seed;
        std.log.scoped(.network_peers).info("remembered_peers_loaded loaded={d} expired={d} duplicate={d} invalid={d}", .{ seeds[@intFromEnum(Seed.loaded)], seeds[@intFromEnum(Seed.expired)], seeds[@intFromEnum(Seed.duplicate)], seeds[@intFromEnum(Seed.invalid)] });
    }
    /// Refreshes the records of connections that qualify now, then copies every unexpired record.
    pub fn rememberedPeers(self: *PeerManager, now: Now, out: []peers.remembered.Record) usize {
        self.catalog.rememberConnected(now);
        return self.catalog.remembered.snapshot(peers.remembered.seconds(now), out);
    }
    pub fn peerCounts(self: *const PeerManager) PeerCounts {
        var result: PeerCounts = .{ .connected = 0, .relevant = 0, .outbound_relevant = 0 };
        for (self.catalog.rows) |row| {
            if (!row.occupied or row.connection == null) continue;
            result.connected += 1;
            if (row.status == null) continue;
            result.relevant += 1;
            if (row.direction == .outbound) result.outbound_relevant += 1;
        }
        return result;
    }
    pub fn gossipScore(self: *PeerManager, gossipsub: *gossip.Gossipsub, peer: t.PeerRef, now: Now) ?f64 {
        const snapshot = self.catalog.rowFor(peer) orelse return null;
        return gossipsub.scoreSnapshot(
            snapshot.connection orelse return null,
            now,
        );
    }
};

test {
    _ = @import("peer_manager_test.zig");
    _ = @import("peer_manager_selection_test.zig");
}
