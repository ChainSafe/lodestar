//! Goldilocks AC, fgsa-spec.pdf Section 3, Figs. 7–9.
//!
//! Call every public tick in order, before same-time incoming objects. Process returned votes as
//! broadcasts; their local admission already happened. Node validates ingress before FG acceptance,
//! then calls onBlock once for each accepted block. Frames borrow FG-owned data and may change at
//! every call. Node owns monotonic time, tick order, duty scheduling, and future-block rejection.
//! Native callers must supply authenticated inputs, valid frames, and times inside the run horizon.
//! Roots identify immutable blocks across frames; finalized ancestry must not regress.
//! Time is an exact caller-selected unit; delta is the number of units per public tick.
//! Input authentication is supplied by the environment. Preserve real signatures in its adapter.
//! Bounds describe supported simulation runs, not extra protocol validity rules. Capacity errors
//! invalidate a run. This module neither evicts protocol history nor silently truncates payloads.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const VoteSet = @import("VoteSet.zig");

pub const Frame = @import("../fg/FinalityFrame.zig");
pub const Payload = Frame.Payload;
pub const SignedVote = Frame.SignedVote;
const Root = types.Root;
const Time = types.Time;
const Slot = types.Slot;
const Vote = types.GoldfishVote;
const Mask = Frame.Mask;
pub const max_payload_votes = 2 * limits.max_validators;

comptime {
    assert(max_payload_votes <= limits.max_vote_set);
    assert(limits.max_slots >= 2);
}

/// AC state A from Section 3.2 (p. 10), plus configuration.
/// FG owns block contents; AC retains block roots, receipt times, and accepted votes.
pub const AvailableChain = struct {
    /// Fixed protocol parameters and supported-run configuration; not part of the paper's A.
    config: Config,
    /// A.gf_votes: accepted votes grouped by slot, at most two distinct votes per validator.
    /// Each entry also stores A.timestamp[vote], its first receipt time.
    pools: [limits.max_slots]Pool,
    /// Block portion of A.timestamp: roots and times when FG accepted blocks and notified AC.
    /// These entries do not contain block contents.
    observations: BoundedArray(Observation, limits.max_blocks),
    /// A.saved_confirmation: raw per-slot results, saved even when a live lock vetoes them.
    /// null means no saved block. Later slow-lock tests read this history.
    saved_confirmation: [limits.max_slots]?Root,
    /// A.locks: block roots and fixed expiry deadlines. Entries may share a root, not a deadline.
    /// An entry is live only while unexpired and its block remains in the current FG frame.
    locks: BoundedArray(Lock, limits.max_slots),
    /// A.fast_confirmed: block roots passing the latest confirmation update's fast test.
    /// Empty after a missing or vetoed result. Supplies fg_confirmed, not FG finality.
    fast_confirmed: BoundedArray(Root, limits.max_blocks),
    /// A.latest_confirmed: the stored confirmation record, not the public confirmed tip.
    /// confirmed() returns its common ancestor with the head, or F if the record left the frame.
    latest_confirmed: Root,
    /// A.restart_time: the latest restart time. null represents initial minus infinity.
    /// The initial node is joined; after restart, joined() enforces the observation period.
    restart_time: ?Time,

    pub const Config = struct {
        /// Root of the genesis block shared with FG.
        genesis_root: Root,
        /// Number of validators in the fixed, unit-weight validator set; at least one.
        validator_count: u32,
        /// Local signing identity; validator_index < validator_count.
        validator_index: u32,
        /// Block and AC-message delivery parameter, in clock units; delta > 0.
        /// Public ticks are delta units apart. Slots last 4 * delta units.
        delta: Time,
        /// FG attestation delivery parameter, in clock units; delta_f >= delta.
        /// AC uses this parameter to validate the minimum round length.
        delta_f: Time,
        /// Slots per FG round; R >= max(2, ceil((6 * delta + delta_f) / (4 * delta))).
        R: u32,
        /// Slow-confirmation window in slots; k >= 2. The slow test reads k - 1 prior confirmations.
        /// A lock from slot s expires at the start of slot s + k, plus 5 * delta clock units.
        k: u32,
    };
    pub const Error = error{
        InvalidConfig,
        PayloadCapacity,
        BlockCapacity,
    };
    pub const Admission = enum {
        accepted,
        duplicate,
        stale,
        future,
        invalid_validator,
        equivocator_limit,
    };
    pub const Lock = struct { block: Root, deadline: Time };
    /// What a restart keeps of A: the locks and the confirmation record.
    pub const Durable = struct {
        locks: BoundedArray(Lock, limits.max_slots),
        latest_confirmed: Root,

        pub fn eql(a: *const Durable, b: *const Durable) bool {
            if (!rootsEqual(&a.latest_confirmed, &b.latest_confirmed)) return false;
            if (a.locks.count != b.locks.count) return false;
            for (a.locks.constSlice(), b.locks.constSlice()) |*x, *y| {
                if (x.deadline != y.deadline or !rootsEqual(&x.block, &y.block)) return false;
            }
            return true;
        }
    };
    pub const VoteList = BoundedArray(SignedVote, max_payload_votes);
    pub const SupportList = BoundedArray(Vote, max_payload_votes);
    pub const Proposal = struct {
        parent: Root,
        votes: VoteList,
        support_votes: SupportList,
    };
    pub const FGInput = struct { fg_confirmed: ?Root, head: Root };
    const Entry = struct { vote: Vote, timestamp: Time };
    const Pool = BoundedArray(Entry, max_payload_votes);
    const Observation = struct { root: Root, timestamp: Time };
    const Scores = struct { blocks: [limits.max_blocks]u32, participants: u32 };

    pub fn init(self: *AvailableChain, config: *const Config) Error!void {
        // Spec Section 1.1 (p. 2): V contains n >= 1 validators.
        if (config.validator_count == 0 or
            // max_validators bounds storage, not the spec's validator set.
            config.validator_count > limits.max_validators)
            return error.InvalidConfig;

        // Spec Section 1.1 (p. 2) names the local identity val_index.
        if (config.validator_index >= config.validator_count) return error.InvalidConfig;

        // Spec Section 3.1 (p. 8): the slow window has k >= 2 slots.
        if (config.k < 2 or
            // k <= max_slots is a bounded-run restriction.
            config.k > limits.max_slots)
            return error.InvalidConfig;

        // Spec Section 3.1 (p. 8): R >= max{2, ceil((6*delta + delta_f)/(4*delta))}.
        if (config.R < 2 or
            // R <= max_slots is a bounded-run restriction.
            config.R > limits.max_slots)
        {
            return error.InvalidConfig;
        }

        // Spec Section 3.1 (pp. 8–9): a lock deadline is (4*(s+k) + 5)*delta.
        // Implementation: s and k are bounded by max_slots; reserve time for both.
        const time_factor = 4 * (2 * limits.max_slots) + 5;
        // Spec Sections 1.1, 3.1 (pp. 2, 8): slot starts increase strictly by 4*delta.
        // Therefore delta > 0.
        // Implementation: the upper bound prevents overflow of u32 Time values.
        if (config.delta == 0 or
            config.delta > std.math.maxInt(Time) / time_factor)
            return error.InvalidConfig;

        // Spec Section 1.1 (p. 2): the attestation delivery parameter delta_f >= delta.
        if (config.delta_f < config.delta) return error.InvalidConfig;

        // Spec Section 3.1 (p. 8): R >= ceil((6*delta + delta_f)/(4*delta)).
        // For positive delta, this is equivalent to 4*delta*R >= 6*delta + delta_f.
        if (6 * @as(u64, config.delta) + config.delta_f >
            4 * @as(u64, config.delta) * config.R) return error.InvalidConfig;
        self.config = config.*;
        self.locks = .{};
        self.latest_confirmed = config.genesis_root;
        self.resetVolatile();
        self.restart_time = null;
    }

    /// Stateless AC payload check. The caller also checks the block signature and content root.
    pub fn validPayload(self: *const AvailableChain, block: *const Frame.Block) Error!bool {
        if (block.payload.votes.len > max_payload_votes or
            block.payload.support_votes.len > max_payload_votes)
        {
            return error.PayloadCapacity;
        }
        for (block.payload.votes) |*signed| {
            if (!signed.authenticated) return false;
            if (signed.vote.val_index >= self.config.validator_count) return false;
            if (block.slot == 0 or signed.vote.slot != block.slot - 1) return false;
        }
        for (block.payload.support_votes) |*support| {
            var present = false;
            for (block.payload.votes) |*signed| {
                if (signed.vote.eql(support)) {
                    present = true;
                    break;
                }
            }
            if (!present) return false;
        }
        return true;
    }

    /// Figure 7, lines 12-13. The caller must authenticate the exact vote and its slot seat.
    pub fn onMessage(
        self: *AvailableChain,
        t: Time,
        vote: *const Vote,
    ) Error!Admission {
        return self.onGoldfishVote(t, vote);
    }

    /// Figure 7, lines 14-17. Node calls once, only after FG accepts the validated block.
    pub fn onBlock(
        self: *AvailableChain,
        t: Time,
        block: *const Frame.Block,
    ) Error!void {
        assert(block.slot > 0);
        assert(self.observation(&block.root) == null);
        if (self.observations.full()) return error.BlockCapacity;
        self.observeBlock(t, block);
    }

    /// Returns the unsigned vote to broadcast. Local admission happens before return.
    pub fn onTick(self: *AvailableChain, frame: *const Frame, t: Time) Error!?Vote {
        return self.tick(frame, t, true);
    }

    /// A public tick the host reaches late: lock expiry, unlocking, and the confirmation update
    /// still run at the tick's nominal time, but the voting window has passed and no vote is cast.
    pub fn onTickLate(self: *AvailableChain, frame: *const Frame, t: Time) Error!void {
        const emitted = try self.tick(frame, t, false);
        assert(emitted == null);
    }

    fn tick(self: *AvailableChain, frame: *const Frame, t: Time, vote: bool) Error!?Vote {
        assert(t % self.config.delta == 0);
        assert(frame.tree.len > 0);
        self.expireLocks(t);
        const s = self.slot(t);
        const slot_start = self.slotStart(s);
        var emitted: ?Vote = null;
        if (t == slot_start + self.config.delta and self.joined(t)) {
            if (s > 0) self.unlock(frame, t, s - 1);
            if (vote) emitted = self.goldfishVote(frame, t);
        }
        if (t == slot_start + 2 * self.config.delta and s > 0) {
            self.updateConfirmation(frame, t, s - 1);
        }
        return emitted;
    }

    /// Runs only at a slot start, after onTick. A false result means the node is not joined.
    pub fn proposal(
        self: *const AvailableChain,
        frame: *const Frame,
        t: Time,
        out: *Proposal,
    ) Error!bool {
        assert(t == self.slotStart(self.slot(t)));
        if (!self.joined(t)) return false;
        const s = self.slot(t);
        out.* = .{ .parent = undefined, .votes = .{}, .support_votes = .{} };
        if (s > 0) {
            for (self.pools[s - 1].constSlice()) |*entry| {
                out.votes.push(.{ .vote = entry.vote, .authenticated = true });
                if (self.resolutionTime(frame, s - 1, &entry.vote) != null) {
                    out.support_votes.push(entry.vote);
                }
            }
        }
        const set = self.poolSet(frame, if (s == 0) null else s - 1, null, null);
        out.parent = frame.tree[self.headIn(frame, t, &frame.viableTree(&frame.all()), &set)].root;
        return true;
    }

    /// Runs at a_r, after this tick's confirmation update. No fresh fast result means no FG vote.
    pub fn toFG(self: *const AvailableChain, frame: *const Frame, t: Time) Error!FGInput {
        assert(t >= 6 * self.config.delta);
        assert((t - 6 * self.config.delta) % (4 * self.config.delta * self.config.R) == 0);
        const set = self.poolSet(frame, self.slot(t), null, null);
        const viable = frame.viableTree(&frame.all());
        const head_index = self.headIn(frame, t, &viable, &set);
        var confirmed_index: ?u32 = null;
        if (self.joined(t)) {
            for (self.fast_confirmed.constSlice()) |*root| {
                const index = frame.find(root) orelse continue;
                if (viable[index] and self.deeper(frame, index, confirmed_index)) {
                    confirmed_index = index;
                }
            }
        }
        return .{
            .fg_confirmed = if (confirmed_index) |index| frame.tree[index].root else null,
            .head = frame.tree[head_index].root,
        };
    }

    pub fn head(self: *const AvailableChain, frame: *const Frame, t: Time) Error!Root {
        return frame.tree[self.currentHead(frame, t)].root;
    }

    pub fn confirmed(self: *const AvailableChain, frame: *const Frame, t: Time) Error!Root {
        var candidate = frame.find(&self.latest_confirmed) orelse 0;
        const head_index = self.currentHead(frame, t);
        for (0..limits.max_blocks) |_| {
            if (frame.isAncestor(candidate, head_index)) return frame.tree[candidate].root;
            candidate = frame.parent(candidate);
        }
        unreachable;
    }

    pub fn durable(self: *const AvailableChain) Durable {
        return .{ .locks = self.locks, .latest_confirmed = self.latest_confirmed };
    }

    /// For a node rebuilt from storage: call after init and before restart.
    pub fn restoreDurable(self: *AvailableChain, saved: *const Durable) void {
        self.locks = saved.locks;
        self.latest_confirmed = saved.latest_confirmed;
    }

    /// Wake/restart may skip sleeping ticks. Locks and latest_confirmed retain their old values.
    pub fn restart(self: *AvailableChain, frame: *const Frame, t: Time) Error!void {
        self.resetVolatile();
        self.restart_time = t;
        for (frame.tree) |*block| {
            if (!rootsEqual(&block.root, &self.config.genesis_root)) self.observeBlock(t, block);
        }
    }

    pub fn resolutionTime(
        self: *const AvailableChain,
        frame: *const Frame,
        s: Slot,
        vote: *const Vote,
    ) ?Time {
        assert(s < limits.max_slots);
        assert(s == vote.slot);
        const index = frame.find(&vote.head) orelse return null;
        if (frame.tree[index].slot > s) return null;
        for (self.pools[s].constSlice()) |*entry| {
            if (!entry.vote.eql(vote)) continue;
            if (rootsEqual(&vote.head, &self.config.genesis_root)) return entry.timestamp;
            const block_time = self.observation(&vote.head) orelse return null;
            return @max(entry.timestamp, block_time);
        }
        return null;
    }

    fn resetVolatile(self: *AvailableChain) void {
        self.pools = @splat(.{});
        self.observations = .{};
        self.saved_confirmation = @splat(null);
        self.fast_confirmed = .{};
    }

    fn slot(self: *const AvailableChain, t: Time) Slot {
        const s = t / (4 * self.config.delta);
        assert(s < limits.max_slots);
        return s;
    }

    fn slotStart(self: *const AvailableChain, s: Slot) Time {
        return 4 * self.config.delta * s;
    }

    fn joined(self: *const AvailableChain, t: Time) bool {
        const restarted = self.restart_time orelse return true;
        const s = self.slot(t);
        return s > 0 and restarted <= self.slotStart(s - 1);
    }

    fn observation(self: *const AvailableChain, root: *const Root) ?Time {
        for (self.observations.constSlice()) |*held| {
            if (rootsEqual(&held.root, root)) return held.timestamp;
        }
        return null;
    }

    fn observeBlock(self: *AvailableChain, t: Time, block: *const Frame.Block) void {
        assert(self.observation(&block.root) == null);
        assert(!self.observations.full());
        self.observations.push(.{ .root = block.root, .timestamp = t });
        for (block.payload.votes) |*signed| _ = self.onGoldfishVote(t, &signed.vote);
    }

    fn onGoldfishVote(self: *AvailableChain, t: Time, vote: *const Vote) Admission {
        const s = self.slot(t);

        // Figure 7, line 20: committee membership and the current/previous-slot admission window.
        if (s > 0 and vote.slot < s - 1) return .stale;
        if (vote.slot > s) return .future;
        if (vote.val_index >= self.config.validator_count) return .invalid_validator;

        const pool = &self.pools[vote.slot];
        var count: u32 = 0;
        for (pool.constSlice()) |*entry| {
            if (entry.vote.eql(vote)) return .duplicate;
            if (entry.vote.val_index == vote.val_index) count += 1;
        }
        if (count == 2) return .equivocator_limit;
        assert(!pool.full());
        pool.push(.{ .vote = vote.*, .timestamp = t });
        return .accepted;
    }

    /// Sweeps the `AvailableChain`'s state for locks
    /// past its `deadline` and mark them expired.
    fn expireLocks(self: *AvailableChain, t: Time) void {
        var retained: u32 = 0;
        for (self.locks.constSlice()) |lock| {
            if (lock.deadline <= t) continue;
            self.locks.buffer[retained] = lock;
            retained += 1;
        }
        self.locks.count = retained;
    }

    fn live(self: *const AvailableChain, frame: *const Frame, t: Time, lock: *const Lock) ?u32 {
        _ = self;
        if (lock.deadline <= t) return null;
        return frame.find(&lock.block);
    }

    fn conflicts(frame: *const Frame, a: u32, b: u32) bool {
        return !frame.isAncestor(a, b) and !frame.isAncestor(b, a);
    }

    fn counts(set: *const VoteSet) [limits.max_validators]u32 {
        var result: [limits.max_validators]u32 = @splat(0);
        for (set.votes.constSlice()) |*vote| result[vote.val_index] += 1;
        return result;
    }

    fn merge(set: *VoteSet, vote: *const Vote, supported: bool) void {
        // Two distinct tuples preserve every score contribution of an equivocator.
        if (set.indexOf(vote) == null and set.countByValidator(vote.val_index) == 2) return;
        set.add(vote, supported);
    }

    fn poolSet(
        self: *const AvailableChain,
        frame: *const Frame,
        s: ?Slot,
        received_before: ?Time,
        resolved_before: ?Time,
    ) VoteSet {
        var set: VoteSet = .{};
        const vote_slot = s orelse return set;
        for (self.pools[vote_slot].constSlice()) |*entry| {
            if (received_before) |cutoff| {
                if (entry.timestamp >= cutoff) continue;
            }
            const resolution = self.resolutionTime(frame, vote_slot, &entry.vote);
            const supported = if (resolution) |time|
                (if (resolved_before) |cutoff| time < cutoff else true)
            else
                false;
            merge(&set, &entry.vote, supported);
        }
        return set;
    }

    fn scores(frame: *const Frame, set: *const VoteSet, confirmation: bool) Scores {
        const per_validator = counts(set);
        var result: Scores = .{ .blocks = @splat(0), .participants = 0 };
        var equivocators: u32 = 0;
        for (per_validator) |count| {
            if (count > 0) result.participants += 1;
            if (count == 2) equivocators += 1;
        }
        if (!confirmation) @memset(&result.blocks, equivocators);
        for (set.votes.constSlice(), 0..) |*vote, i| {
            if (per_validator[vote.val_index] != 1 or !set.support[i]) continue;
            var cursor = frame.find(&vote.head).?;
            for (0..limits.max_blocks) |_| {
                result.blocks[cursor] += 1;
                if (cursor == 0) break;
                cursor = frame.parent(cursor);
            } else unreachable;
        }
        return result;
    }

    fn deeper(self: *const AvailableChain, frame: *const Frame, candidate: u32, old: ?u32) bool {
        _ = self;
        const previous = old orelse return true;
        const depth = frame.depth(candidate);
        const old_depth = frame.depth(previous);
        if (depth != old_depth) return depth > old_depth;
        return types.rootOrder(&frame.tree[candidate].root, &frame.tree[previous].root) == .gt;
    }

    fn anchor(self: *const AvailableChain, frame: *const Frame, t: Time) u32 {
        const viable = frame.viableTree(&frame.all());
        var best: ?u32 = null;
        for (frame.tree, 0..) |_, i| {
            if (!viable[i]) continue;
            const index: u32 = @intCast(i);
            for (self.locks.constSlice()) |*lock| {
                const lock_index = self.live(frame, t, lock) orelse continue;
                if (frame.isAncestor(index, lock_index) and self.deeper(frame, index, best)) {
                    best = index;
                }
            }
        }
        return best orelse frame.find(&frame.fc_root).?;
    }

    fn walk(
        self: *const AvailableChain,
        frame: *const Frame,
        t: Time,
        domain: *const Mask,
        start: u32,
        score: *const Scores,
        confirmation: bool,
    ) u32 {
        var cursor = start;
        for (0..limits.max_blocks) |_| {
            var best: ?u32 = null;
            for (frame.tree, 0..) |*block, i| {
                if (i == 0 or !domain[i]) continue;
                if (!rootsEqual(&block.parent, &frame.tree[cursor].root)) continue;
                const eligible = 2 * score.blocks[i] > score.participants;
                if (confirmation) {
                    if (!eligible) continue;
                } else {
                    if (frame.viable_heads[cursor] and block.slot != self.slot(t) and !eligible) {
                        continue;
                    }
                }
                if (best) |previous| {
                    if (score.blocks[i] < score.blocks[previous]) continue;
                    if (score.blocks[i] == score.blocks[previous]) {
                        const order = types.rootOrder(&block.root, &frame.tree[previous].root);
                        if (order != .gt) continue;
                    }
                }
                best = @intCast(i);
            }
            cursor = best orelse return cursor;
        }
        unreachable;
    }

    fn headIn(
        self: *const AvailableChain,
        frame: *const Frame,
        t: Time,
        domain: *const Mask,
        set: *const VoteSet,
    ) u32 {
        const score = scores(frame, set, false);
        return self.walk(frame, t, domain, self.anchor(frame, t), &score, false);
    }

    fn currentHead(self: *const AvailableChain, frame: *const Frame, t: Time) u32 {
        const s = self.slot(t);
        const vote_slot = if (t - self.slotStart(s) >= 2 * self.config.delta)
            s
        else if (s > 0) s - 1 else null;
        const set = self.poolSet(frame, vote_slot, null, null);
        return self.headIn(frame, t, &frame.viableTree(&frame.all()), &set);
    }

    /// Figure 9, lines 37-48. Returns the outgoing vote after local admission.
    fn goldfishVote(self: *AvailableChain, frame: *const Frame, t: Time) Vote {
        const vote: Vote = .{
            .val_index = self.config.validator_index,
            .slot = self.slot(t),
            .head = frame.tree[self.voteHead(frame, t)].root,
        };
        _ = self.onGoldfishVote(t, &vote);
        return vote;
    }

    fn voteHead(self: *const AvailableChain, frame: *const Frame, t: Time) u32 {
        const s = self.slot(t);
        const freeze: ?Time = if (s == 0) null else self.slotStart(s) - self.config.delta;
        var set = if (s == 0) VoteSet{} else self.poolSet(frame, s - 1, freeze, freeze);
        var domain: Mask = @splat(false);
        for (frame.tree, 0..) |*block, i| {
            if (rootsEqual(&block.root, &self.config.genesis_root)) {
                domain[i] = true;
            } else if (freeze) |cutoff| {
                domain[i] = self.observation(&block.root).? < cutoff;
            }
            if (block.slot != s) continue;
            var cursor: u32 = @intCast(i);
            for (0..limits.max_blocks) |_| {
                domain[cursor] = true;
                if (cursor == 0) break;
                cursor = frame.parent(cursor);
            } else unreachable;
            for (block.payload.votes) |*signed| merge(&set, &signed.vote, false);
            for (block.payload.support_votes) |*vote| {
                const head_index = frame.find(&vote.head) orelse continue;
                if (frame.tree[head_index].slot <= vote.slot) merge(&set, vote, true);
            }
        }
        const viable = frame.viableTree(&domain);
        return self.headIn(frame, t, &viable, &set);
    }

    fn unlock(self: *AvailableChain, frame: *const Frame, t: Time, s: Slot) void {
        const set = self.poolSet(frame, s, null, null);
        const per_validator = counts(&set);
        var retained: u32 = 0;
        for (self.locks.constSlice()) |*lock| {
            var cursor = self.live(frame, t, lock) orelse continue;
            for (0..limits.max_blocks) |_| {
                var opponents: u32 = 0;
                for (set.votes.constSlice(), 0..) |*vote, i| {
                    if (per_validator[vote.val_index] != 1 or !set.support[i]) continue;
                    if (conflicts(frame, cursor, frame.find(&vote.head).?)) opponents += 1;
                }
                if (2 * opponents < self.config.validator_count) break;
                cursor = frame.parent(cursor);
            } else unreachable;
            self.locks.buffer[retained] = .{
                .block = frame.tree[cursor].root,
                .deadline = lock.deadline,
            };
            retained += 1;
        }
        self.locks.count = retained;
    }

    /// Slow test for confirmation
    fn slow(self: *const AvailableChain, frame: *const Frame, s: Slot, index: u32) bool {
        if (s + 1 < self.config.k) return false;
        for (s + 1 - self.config.k..s) |j| {
            const root = self.saved_confirmation[j] orelse return false;
            const previous = frame.find(&root) orelse return false;
            if (!frame.isAncestor(index, previous)) return false;
        }
        return true;
    }

    fn vetoed(self: *const AvailableChain, frame: *const Frame, t: Time, candidate: u32) bool {
        for (self.locks.constSlice()) |*lock| {
            const index = self.live(frame, t, lock) orelse continue;
            if (conflicts(frame, candidate, index)) return true;
        }
        return false;
    }

    fn updateConfirmation(self: *AvailableChain, frame: *const Frame, t: Time, s: Slot) void {
        self.fast_confirmed = .{};
        if (!self.joined(t)) {
            self.saved_confirmation[s] = null;
            return;
        }
        const cutoff = self.slotStart(s) + 2 * self.config.delta;
        const set = self.poolSet(frame, s, null, cutoff);
        const score = scores(frame, &set, true);
        const candidate = self.walk(frame, t, &frame.all(), 0, &score, true);
        if (2 * score.blocks[candidate] <= score.participants) {
            self.saved_confirmation[s] = null;
            return;
        }
        self.saved_confirmation[s] = frame.tree[candidate].root;
        if (self.vetoed(frame, t, candidate)) return;
        const old = frame.find(&self.latest_confirmed);
        if (old == null or !frame.isAncestor(candidate, old.?)) {
            self.latest_confirmed = frame.tree[candidate].root;
        }
        var lock_block: ?u32 = null;
        for (frame.tree, 0..) |*block, i| {
            if (rootsEqual(&block.root, &self.config.genesis_root)) continue;
            const index: u32 = @intCast(i);
            if (!frame.isAncestor(index, candidate)) continue;
            // If more than half of the validators voted for this block,
            // fast lock it
            const fast = 2 * score.blocks[i] >= self.config.validator_count;
            if (fast) self.fast_confirmed.push(block.root);
            if ((fast or
                self.slow(frame, s, index)) and self.deeper(frame, index, lock_block))
            {
                lock_block = index;
            }
        }
        if (lock_block) |index| {
            assert(!self.locks.full());
            self.locks.push(.{
                .block = frame.tree[index].root,
                .deadline = self.slotStart(s + self.config.k) + 5 * self.config.delta,
            });
        }
    }
};

fn rootsEqual(a: *const Root, b: *const Root) bool {
    return std.mem.eql(u8, a, b);
}

test {
    _ = @import("available_chain_test.zig");
}
