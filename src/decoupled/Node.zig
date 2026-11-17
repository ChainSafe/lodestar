//! Goldilocks coordinator, fgsa-spec.pdf Sections 1.2-1.6, Figure 2.
//! Dependencies are concrete types selected at compile time. Serialize calls to each instance.
//! Allocate in place. Keep dependency addresses stable. No dependency may reenter this Node.
//! Capacity/effect failures stop the instance; never retry a partially completed duty.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const FG = @import("fg/FinalityGadget.zig");
const BlockRef = @import("fg/finality_types.zig").BlockRef;
const Height = @import("fg/finality_types.zig").Height;
const AttestationPool = @import("fg/AttestationPool.zig");
const SigningRecord = @import("fg/SigningRecord.zig");
const AC = @import("ac/available_chain.zig").AvailableChain;
const Frame = @import("fg/FinalityFrame.zig");
const types = @import("types.zig");
const limits = @import("limits.zig");
const Time = types.Time;

/// Shared identity and genesis parameters, plus AC and FG protocol parameters.
pub const Config = struct {
    /// Root of the genesis block shared by AC and FG.
    B_gen: types.Root,
    /// Number of validators in the fixed, unit-weight validator set; n >= 1.
    n: u32,
    /// Local signing identity in the validator set; val_index < n.
    val_index: types.ValidatorIndex,
    /// Available-chain timing and confirmation parameters.
    ac: ACConfig,
    /// Finality-gadget delivery and chain-state parameters.
    fg: FGConfig,
};

pub const ACConfig = struct {
    /// Block and AC-message delivery parameter, in clock units; delta > 0.
    /// Public ticks are delta units apart. Slots last 4 * delta units.
    delta: Time,
    /// Slots per FG round; R >= max(2, ceil((6 * delta + delta_f) / (4 * delta))).
    /// The FG action runs 6 * delta clock units after the round starts.
    R: u32,
    /// Slow-confirmation window in slots; k >= 2. The slow test reads k - 1 prior confirmations.
    /// A lock from slot s expires at the start of slot s + k, plus 5 * delta clock units.
    k: u32,
};

/// Chain-state parameters belong to the StateSource; Node shares them so one Config describes
/// a protocol instance.
pub const FGConfig = struct {
    /// Attestation delivery parameter, in the same clock units as ac.delta; delta_f >= ac.delta.
    /// AC uses this parameter to validate the minimum round length.
    delta_f: Time,
    /// Maximum number of pending justified height-target pairs retained per chain; K_W >= 2.
    /// When the window is full, retain the newest pairs.
    K_W: u32,
    /// Minimum target age in slots before a progress quorum can advance height by timeout.
    /// Age is measured from T_h.slot. Zero permits timeout progress without an added delay.
    delta_t: types.Slot,
};
pub const Admission = enum {
    accepted,
    duplicate,
    stale,
    future,
    invalid_validator,
    equivocator_limit,
    unauthenticated,
};
/// What a client is told: the node's whole promise to the outside.
pub const Tips = struct {
    finalized: BlockRef,
    /// The greatest justification extending the finalized block: an FG height and its target.
    justified: Checkpoint,
    confirmed: BlockRef,
    head: BlockRef,
};
pub const Checkpoint = struct { height: Height, block: BlockRef };
/// One durable input, in the order Node accepted it. A block borrows Storage's memory until the
/// next Storage call.
pub const JournalEntry = union(enum) { block: FG.Block, attestation: FG.Attestation };

/// Clock.now supplies processing time. Signer supplies fixed proposer assignments and authentication.
/// Transport broadcasts synchronously borrowed objects; Storage.persist completes before send.
/// Storage also holds the journal and the AC record that restore() rebuilds a Node from; each
/// write is durable when it returns.
/// Transport.Peer names the sender of a delivery; requestBlock and sendBlock address one peer.
/// StateSource runs the chain-state transition (Figure 5) and answers chain-relative attestation
/// validity; the store reads only its BlockSummary.
/// Both simulation and client adapters instantiate these same transitions.
pub fn NodeType(
    comptime Clock: type,
    comptime Transport: type,
    comptime Storage: type,
    comptime Signer: type,
    comptime StateSource: type,
) type {
    return struct {
        const Node = @This();
        pub const Error = FG.Error || AC.Error || AttestationPool.Error || SigningRecord.Error ||
            StateSource.Error || Transport.Error || Storage.Error || Signer.Error ||
            error{ TimeReversed, HorizonExceeded, TickRequired, TickOrder, Asleep, AlreadyAwake, AlreadyAsleep, Stopped, Reentrant, InvalidProposer, InvalidLocalBlock, InvalidJournal };
        pub const Dependencies = struct {
            clock: *Clock,
            transport: *Transport,
            storage: *Storage,
            signer: *Signer,
            state_source: *StateSource,
        };

        /// Last processing time and next public tick. This bookkeeping is not AC protocol state.
        t: Time,
        next_tick: Time,
        /// Public ticks run delta or more after their nominal time, so without validator duties.
        late_ticks: u32,
        awake: bool,
        stopped: bool,
        busy: bool,
        fg: FG,
        ac: AC,
        pool: AttestationPool,
        Lambda: SigningRecord,
        /// The AC record last written to Storage.
        ac_saved: AC.Durable,
        /// Authenticated blocks refused for an unknown parent, kept until the parent is accepted.
        /// Not protocol state: the paper only permits a later delivery to try again. When full,
        /// the oldest is dropped; a later delivery of one of its descendants asks for it again.
        orphans: BoundedArray(FG.StoredBlock, limits.max_orphans),
        clock: *Clock,
        transport: *Transport,
        storage: *Storage,
        signer: *Signer,
        state_source: *StateSource,
        frame_buffer: FG.FrameBuffer,

        /// Figure 3, lines 44-45: valid against sigma[H] and not yet carried by H's chain.
        const Eligibility = struct {
            fg: *const FG,
            state_source: *const StateSource,
            H: u32,
            root: *const types.Root,

            pub fn eligible(self: Eligibility, a: *const FG.Attestation) bool {
                return self.state_source.validAttestation(self.root, a) and
                    !self.fg.includedOnChain(self.H, a);
            }
        };

        /// New genesis instance only. Sleep/wake must not reinitialize Lambda.
        /// The caller initializes the StateSource for the same genesis and parameters.
        pub fn init(self: *Node, config: *const Config, dependencies: *const Dependencies) Error!void {
            try self.ac.init(&.{
                .genesis_root = config.B_gen,
                .validator_count = config.n,
                .validator_index = config.val_index,
                .delta = config.ac.delta,
                .delta_f = config.fg.delta_f,
                .R = config.ac.R,
                .k = config.ac.k,
            });
            self.ac_saved = self.ac.durable();
            self.fg.init(&.{ .B_gen = config.B_gen });
            self.pool.init();
            try self.Lambda.init(.{ .n = config.n, .val_index = config.val_index });
            self.orphans = .{};
            self.clock = dependencies.clock;
            self.transport = dependencies.transport;
            self.storage = dependencies.storage;
            self.signer = dependencies.signer;
            self.state_source = dependencies.state_source;
            self.t = 0;
            self.next_tick = 0;
            self.late_ticks = 0;
            self.awake = true;
            self.stopped = false;
            self.busy = false;
        }

        /// Host-driven time: run every public tick up to now in order, then process at now.
        /// A tick reached less than delta late still performs its validator duties. A later one runs
        /// only the store duties (lock expiry, unlocking, confirmation) at its nominal time, since
        /// the vote, proposal, or attestation window has passed. Sleep/wake is the restart path for
        /// a host that stopped receiving; this is for a host that kept receiving but called late.
        pub fn advance(self: *Node) Error!void {
            const now = self.clock.now();
            try self.checkTime(now);
            if (!self.awake) return error.Asleep;
            self.busy = true;
            defer self.busy = false;
            errdefer self.stopped = true;
            for (0..4 * limits.max_slots) |_| {
                if (self.next_tick > now) break;
                const tick = self.next_tick;
                self.t = tick;
                self.next_tick += self.ac.config.delta;
                const on_time = now - tick < self.ac.config.delta;
                if (!on_time) self.late_ticks += 1;
                try self.duties(tick, on_time);
            } else unreachable;
            self.t = now;
        }

        /// The exact-tick driver: now must be the next public tick. The simulator calls this at
        /// every public tick so its own discipline stays checked; a client host calls advance.
        pub fn onTick(self: *Node) Error!void {
            const t = self.clock.now();
            try self.checkTime(t);
            if (!self.awake) return error.Asleep;
            if (t != self.next_tick) return error.TickOrder;
            try self.advance();
        }

        /// Figure 2, lines 1-7: AC schedule, assigned non-genesis proposal, then FG action.
        fn duties(self: *Node, tick: Time, on_time: bool) Error!void {
            const Phi = try self.fg.toAC(&self.frame_buffer);
            if (!on_time) {
                try self.ac.onTickLate(&Phi, tick);
                return self.saveAC();
            }
            const vote = try self.ac.onTick(&Phi, tick);
            try self.saveAC();
            if (vote) |v| try self.transport.broadcastVote(&v);
            const s = self.slot();
            if (s > 0 and tick == 4 * self.ac.config.delta * s) {
                if (try self.proposer(s) == self.Lambda.val_index) try self.proposeBlock();
            }
            // Section 3.1: a_r = T_r + 6*delta, with round duration 4*delta*R.
            const first = 6 * self.ac.config.delta;
            const period = 4 * self.ac.config.delta * self.ac.config.R;
            if (tick >= first and (tick - first) % period == 0) try self.attest();
        }

        /// Refusal does not ingest carried objects or notify AC. Later delivery may retry.
        /// An accepted block is forwarded and releases the kept blocks that build on it. A block
        /// refused for an unknown parent is kept, and `from` is asked for the parent. There is no
        /// timer and no retry: a request goes out only when a block arrives.
        pub fn onBlock(self: *Node, from: Transport.Peer, B: *const FG.Block) Error!bool {
            try self.enter();
            defer self.busy = false;
            errdefer self.stopped = true;
            if (try self.acceptBlock(B)) {
                try self.transport.forwardBlock(B);
                try self.adoptOrphans();
                return true;
            }
            try self.keepOrphan(from, B);
            return false;
        }

        /// Answer a peer that asked for an accepted block. Genesis is configuration, never sent.
        pub fn onBlockRequest(self: *Node, from: Transport.Peer, root: *const types.Root) Error!bool {
            try self.enter();
            defer self.busy = false;
            errdefer self.stopped = true;
            const index = self.fg.find(root) orelse return false;
            if (index == 0) return false;
            const B = self.fg.T.buffer[index].view();
            try self.transport.sendBlock(from, &B);
            return true;
        }

        pub fn onACMessage(self: *Node, signed: *const Frame.SignedVote) Error!Admission {
            try self.enter();
            defer self.busy = false;
            errdefer self.stopped = true;
            if (signed.vote.val_index >= self.validatorCount()) return .invalid_validator;
            if (!self.signer.verifyVote(signed)) return .unauthenticated;
            return switch (try self.ac.onMessage(self.t, &signed.vote)) {
                inline else => |tag| @field(Admission, @tagName(tag)),
            };
        }

        /// Figure 3, lines 10-11, into the validator's pool.
        pub fn onAttestation(self: *Node, a: *const FG.Attestation) Error!bool {
            try self.enter();
            defer self.busy = false;
            errdefer self.stopped = true;
            if (!a.valid(self.validatorCount()) or !self.signer.verifyAttestation(a)) return false;
            return self.admit(a);
        }

        /// Sleep may replace a boundary-time tick, but cannot skip an earlier awake tick.
        pub fn sleep(self: *Node) Error!void {
            const t = self.clock.now();
            try self.checkTime(t);
            if (!self.awake) return error.AlreadyAsleep;
            if (t > self.next_tick) return error.TickRequired;
            self.t = t;
            self.awake = false;
        }

        /// Restart AC before the wake-time tick or delivery. fg, the pool, and Lambda persist.
        pub fn wake(self: *Node) Error!void {
            const t = self.clock.now();
            try self.checkTime(t);
            if (self.awake) return error.AlreadyAwake;
            self.busy = true;
            defer self.busy = false;
            errdefer self.stopped = true;
            try self.join(t);
        }

        /// Rebuild a Node whose memory was lost from what Storage holds, then join as wake()
        /// does. The result equals the Node that wake() would have resumed, except that kept
        /// orphans are gone. The caller supplies a StateSource initialized as for init.
        pub fn restore(self: *Node, config: *const Config, dependencies: *const Dependencies) Error!void {
            try self.init(config, dependencies);
            const t = self.clock.now();
            try self.checkTime(t);
            self.busy = true;
            defer self.busy = false;
            errdefer self.stopped = true;
            try self.storage.loadRecord(&self.Lambda);
            for (0..limits.max_journal) |i| {
                const entry = self.storage.journalEntry(@intCast(i)) orelse break;
                switch (entry) {
                    .block => |*B| {
                        const assigned = try self.proposer(B.slot);
                        const summary = try self.state_source.transition(B, assigned) orelse
                            return error.InvalidJournal;
                        try self.pool.checkCapacity(B.attestations);
                        if (!try self.fg.onBlock(B, &summary)) return error.InvalidJournal;
                        self.pool.absorb(B.attestations);
                    },
                    .attestation => |*a| _ = try self.pool.add(a),
                }
            }
            if (self.storage.loadAC()) |saved| {
                self.ac.restoreDurable(&saved);
                self.ac_saved = saved;
            }
            try self.join(t);
        }

        fn join(self: *Node, t: Time) Error!void {
            const Phi = try self.fg.toAC(&self.frame_buffer);
            try self.ac.restart(&Phi, t);
            self.t = t;
            const remainder = t % self.ac.config.delta;
            self.next_tick = if (remainder == 0) t else t + self.ac.config.delta - remainder;
            self.awake = true;
        }

        /// Locks and the confirmation record reach Storage before the tick's vote is sent.
        fn saveAC(self: *Node) Error!void {
            const current = self.ac.durable();
            if (current.eql(&self.ac_saved)) return;
            try self.storage.persistAC(&current);
            self.ac_saved = current;
        }

        /// The journal entry comes first, so a restart rebuilds the pool in the same order.
        fn admit(self: *Node, a: *const FG.Attestation) Error!bool {
            if (self.pool.contains(a)) return false;
            try self.storage.appendAttestation(a);
            return self.pool.add(a);
        }

        /// The answer as of the last processed instant: the finalized block, the justified
        /// checkpoint, the confirmed block and the head. It changes nothing, so a client may ask
        /// at any time between calls. An asleep or stopped node has no output. `scratch` holds
        /// the frame the answer is computed from.
        pub fn tips(self: *const Node, scratch: *FG.FrameBuffer) Error!Tips {
            if (self.stopped) return error.Stopped;
            if (self.busy) return error.Reentrant;
            if (!self.awake) return error.Asleep;
            const Phi = try self.fg.toAC(scratch);
            return .{
                .finalized = self.fg.F,
                .justified = .{ .height = self.fg.h_j, .block = self.fg.J },
                .confirmed = try self.ref(&try self.ac.confirmed(&Phi, self.t)),
                .head = try self.ref(&try self.ac.head(&Phi, self.t)),
            };
        }

        fn ref(self: *const Node, root: *const types.Root) Error!BlockRef {
            const index = self.fg.find(root) orelse return error.UnknownBlock;
            return .{ .root = root.*, .slot = self.fg.T.buffer[index].slot };
        }

        /// Store admission, ingress validation, state transition, then store and AC publication.
        /// The pool reserves room before the block is accepted anywhere; a transition that is
        /// stored but then hits a store bound ends the run (capacity errors stop the Node).
        fn acceptBlock(self: *Node, B: *const FG.Block) Error!bool {
            if (B.slot > self.slot()) return false;
            try checkBlockBounds(B);
            if (!self.fg.canAccept(B)) return false;
            if (!try self.validBlock(B)) return false;
            // T includes genesis; A observes only non-genesis blocks, including after restart.
            assert(self.ac.observations.count < self.fg.T.count);
            assert(self.fg.T.count <= limits.max_blocks);
            const assigned = try self.proposer(B.slot);
            const summary = try self.state_source.transition(B, assigned) orelse return false;
            try self.pool.checkCapacity(B.attestations);
            try self.storage.appendBlock(B);
            const accepted = try self.fg.onBlock(B, &summary);
            assert(accepted);
            self.pool.absorb(B.attestations);
            const projected = project(B);
            try self.ac.onBlock(self.t, &projected);
            assert(self.ac.observations.count < self.fg.T.count);
            return true;
        }

        /// The signature is checked before a block is kept, so an unauthenticated block neither
        /// occupies a slot nor triggers a request. A repeat delivery of a kept block asks its own
        /// sender, so one peer that never answers does not end the recovery.
        fn keepOrphan(self: *Node, from: Transport.Peer, B: *const FG.Block) Error!void {
            if (self.fg.find(&B.root) != null or self.fg.find(&B.parent) != null) return;
            if (B.proposer >= self.validatorCount() or !self.signer.verifyBlock(B)) return;
            try checkBlockBounds(B);
            const kept = for (self.orphans.constSlice()) |*orphan| {
                if (std.mem.eql(u8, &orphan.root, &B.root)) break true;
            } else false;
            if (!kept) {
                if (self.orphans.full()) self.orphans.orderedRemove(0);
                self.orphans.buffer[self.orphans.count].init(B);
                self.orphans.count += 1;
            }
            try self.transport.requestBlock(from, &B.parent);
        }

        /// An accepted orphan can be the parent of another; a refused one is forgotten.
        fn adoptOrphans(self: *Node) Error!void {
            for (0..limits.max_orphans) |_| {
                const i: u32 = for (self.orphans.constSlice(), 0..) |*orphan, i| {
                    if (self.fg.find(&orphan.parent) != null) break @intCast(i);
                } else return;
                const B = self.orphans.buffer[i].view();
                if (try self.acceptBlock(&B)) try self.transport.forwardBlock(&B);
                self.orphans.orderedRemove(i);
            }
        }

        fn validBlock(self: *const Node, B: *const FG.Block) Error!bool {
            if (B.proposer >= self.validatorCount()) return false;
            const projected = project(B);
            if (!try self.ac.validPayload(&projected)) return false;
            if (!self.signer.verifyBlock(B)) return false;
            for (B.ac_payload.votes) |*signed| {
                if (!self.signer.verifyVote(signed)) return false;
            }
            for (B.attestations) |*a| {
                if (!a.valid(self.validatorCount()) or !self.signer.verifyAttestation(a)) return false;
            }
            return true;
        }

        fn proposeBlock(self: *Node) Error!void {
            const Phi = try self.fg.toAC(&self.frame_buffer);
            var P: AC.Proposal = undefined;
            if (!try self.ac.proposal(&Phi, self.t, &P)) return;
            var attestations: AttestationPool.List = undefined;
            try self.pool.select(Eligibility{
                .fg = &self.fg,
                .state_source = self.state_source,
                .H = self.fg.find(&P.parent) orelse return error.UnknownBlock,
                .root = &P.parent,
            }, &attestations);
            var B: FG.Block = .{
                .root = undefined,
                .slot = self.slot(),
                .parent = P.parent,
                .proposer = self.Lambda.val_index,
                .ac_payload = .{
                    .votes = P.votes.constSlice(),
                    .support_votes = P.support_votes.constSlice(),
                },
                .attestations = attestations.constSlice(),
            };
            try self.signer.prepareBlock(&B);
            try self.transport.broadcastBlock(&B);
            if (!try self.acceptBlock(&B)) return error.InvalidLocalBlock;
        }

        /// Figure 3, lines 12-15, with Lambda (Figure 4) deciding whether anything is sent.
        fn attest(self: *Node) Error!void {
            const Phi = try self.fg.toAC(&self.frame_buffer);
            const pair = try self.ac.toFG(&Phi, self.t);
            const fg_confirmed = pair.fg_confirmed orelse return;
            const input = try self.fg.attestationInput(&fg_confirmed, &pair.head);
            const a = try self.Lambda.createAttestation(&input) orelse return;
            try self.storage.persist(&self.Lambda);
            try self.transport.broadcastAttestation(&a);
            _ = try self.admit(&a);
        }

        fn checkTime(self: *const Node, t: Time) Error!void {
            if (self.stopped) return error.Stopped;
            if (self.busy) return error.Reentrant;
            if (t < self.t) return error.TimeReversed;
            if (t >= 4 * self.ac.config.delta * limits.max_slots) return error.HorizonExceeded;
        }
        fn enter(self: *Node) Error!void {
            const t = self.clock.now();
            try self.checkTime(t);
            if (!self.awake) return error.Asleep;
            if (t >= self.next_tick) return error.TickRequired;
            self.t = t;
            self.busy = true;
        }
        fn proposer(self: *const Node, s: types.Slot) Error!types.ValidatorIndex {
            const index = self.signer.proposer(s);
            if (index >= self.validatorCount()) return error.InvalidProposer;
            return index;
        }
        fn validatorCount(self: *const Node) u32 {
            return self.ac.config.validator_count;
        }
        fn slot(self: *const Node) types.Slot {
            const s = self.t / (4 * self.ac.config.delta);
            assert(s < limits.max_slots);
            return s;
        }
    };
}

fn checkBlockBounds(B: *const FG.Block) (FG.Error || AC.Error)!void {
    if (B.attestations.len > limits.max_attestations_per_block) return error.AttestationCapacity;
    if (B.ac_payload.votes.len > limits.max_vote_set or
        B.ac_payload.support_votes.len > limits.max_vote_set) return error.PayloadCapacity;
}
fn project(B: *const FG.Block) Frame.Block {
    return .{ .root = B.root, .slot = B.slot, .parent = B.parent, .payload = B.ac_payload };
}
