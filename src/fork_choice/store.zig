const std = @import("std");
const Allocator = std.mem.Allocator;

const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;
const state_transition = @import("state_transition");

const CachedBeaconState = state_transition.CachedBeaconState;

const Slot = primitives.Slot.Type;
const Epoch = primitives.Epoch.Type;
const Root = primitives.Root.Type;

const compute_deltas_mod = @import("compute_deltas.zig");
const EquivocatingIndices = compute_deltas_mod.EquivocatingIndices;

/// Checkpoint with root.
pub const Checkpoint = struct {
    epoch: Epoch,
    root: Root,

    /// Compare checkpoint identity (epoch + root).
    pub fn eql(a: Checkpoint, b: Checkpoint) bool {
        return a.epoch == b.epoch and
            std.mem.eql(u8, &a.root, &b.root);
    }
};

/// Reference-counted effective balance increments.
pub const JustifiedBalancesRc = state_transition.EffectiveBalanceIncrementsRc;

/// Effective balance increments (1 increment = 1 ETH effective balance).
pub const JustifiedBalances = state_transition.EffectiveBalanceIncrements;

/// Sum all effective balance increments.
pub fn computeTotalBalance(balances: []const u16) u64 {
    var total: u64 = 0;
    for (balances) |b| {
        total += b;
    }
    return total;
}

/// Returns the justified balances of checkpoint.
/// MUST not throw an error in any case, related to cache miss. Either trigger regen
/// or approximate from a close state.
pub const JustifiedBalancesGetter = struct {
    context: ?*anyopaque = null,
    getFn: *const fn (context: ?*anyopaque, checkpoint: Checkpoint, state: *CachedBeaconState) JustifiedBalances,

    pub fn get(self: JustifiedBalancesGetter, checkpoint: Checkpoint, state: *CachedBeaconState) JustifiedBalances {
        return self.getFn(self.context, checkpoint, state);
    }
};

/// Event callback: context + fn pointer pair.
pub const EventCallback = struct {
    context: ?*anyopaque = null,
    callFn: *const fn (context: ?*anyopaque, cp: Checkpoint) void,

    pub fn call(self: EventCallback, cp: Checkpoint) void {
        self.callFn(self.context, cp);
    }
};

/// Event callbacks for checkpoint updates.
pub const ForkChoiceStoreEvents = struct {
    on_justified: ?EventCallback = null,
    on_finalized: ?EventCallback = null,
};

/// Approximates the `Store` in "Ethereum Consensus -- Beacon Chain Fork Choice":
/// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#store
///
/// This is only an approximation for two reasons:
/// - The actual block DAG in `ProtoArray`.
/// - `time` is represented using `Slot` instead of UNIX epoch `u64`.
///
/// Emits forkChoice events on updated justified and finalized checkpoints.
pub const ForkChoiceStore = struct {
    /// Current slot (updated via onTick).
    current_slot: Slot,

    /// Realized justified checkpoint with balances (from epoch boundary processing).
    justified: JustifiedState,
    /// Unrealized justified checkpoint with balances from pull-up FFG.
    unrealized_justified: JustifiedState,
    /// Realized finalized checkpoint.
    finalized_checkpoint: Checkpoint,
    /// Unrealized finalized checkpoint from pull-up FFG.
    unrealized_finalized_checkpoint: Checkpoint,

    /// Set of equivocating validator indices (from attester slashings).
    equivocating_indices: EquivocatingIndices,

    /// Callback for retrieving justified balances on demand.
    justified_balances_getter: JustifiedBalancesGetter,

    /// Event callbacks for checkpoint updates.
    events: ForkChoiceStoreEvents,

    /// Justified checkpoint + balances + totalBalance bundled together.
    /// Balances are reference-counted: justified and unrealized_justified may share
    pub const JustifiedState = struct {
        checkpoint: Checkpoint,
        balances: *JustifiedBalancesRc,
        total_balance: u64,
    };

    pub fn init(
        self: *ForkChoiceStore,
        allocator: Allocator,
        current_slot: Slot,
        justified_checkpoint: Checkpoint,
        finalized_checkpoint: Checkpoint,
        justified_balances: []const u16,
        justified_balances_getter: JustifiedBalancesGetter,
        events: ForkChoiceStoreEvents,
    ) !void {
        var balances_list: JustifiedBalances = .empty;
        errdefer balances_list.deinit(allocator);

        try balances_list.appendSlice(allocator, justified_balances);

        const balances_rc = try JustifiedBalancesRc.create(allocator, balances_list);
        errdefer balances_rc.unref();

        const total = computeTotalBalance(justified_balances);

        // referenced by `unrealized_justified`
        _ = balances_rc.ref();

        self.* = .{
            .current_slot = current_slot,
            .justified = .{
                .checkpoint = justified_checkpoint,
                .balances = balances_rc,
                .total_balance = total,
            },
            .unrealized_justified = .{
                .checkpoint = justified_checkpoint,
                .balances = balances_rc,
                .total_balance = total,
            },
            .finalized_checkpoint = finalized_checkpoint,
            .unrealized_finalized_checkpoint = finalized_checkpoint,
            .equivocating_indices = .empty,
            .justified_balances_getter = justified_balances_getter,
            .events = events,
        };
    }

    /// Set the justified checkpoint and balances, recomputing totalBalance.
    /// Receives raw balances slice, internally creates a new Rc (matching state_transition pattern).
    /// Fires onJustified event if configured.
    pub fn setJustified(self: *ForkChoiceStore, allocator: Allocator, checkpoint: Checkpoint, balances: []const u16) !void {
        var balances_list: JustifiedBalances = .empty;
        errdefer balances_list.deinit(allocator);

        try balances_list.appendSlice(allocator, balances);

        const balances_rc = try JustifiedBalancesRc.create(allocator, balances_list);

        self.justified.balances.unref();
        self.justified = .{
            .checkpoint = checkpoint,
            .balances = balances_rc,
            .total_balance = computeTotalBalance(balances),
        };
        if (self.events.on_justified) |cb| cb.call(checkpoint);
    }

    /// Set the finalized checkpoint.
    /// Fires onFinalized event if configured.
    pub fn setFinalizedCheckpoint(self: *ForkChoiceStore, checkpoint: Checkpoint) void {
        self.finalized_checkpoint = checkpoint;
        if (self.events.on_finalized) |cb| cb.call(checkpoint);
    }

    pub fn deinit(self: *ForkChoiceStore, allocator: Allocator) void {
        self.equivocating_indices.deinit(allocator);
        self.justified.balances.unref();
        self.unrealized_justified.balances.unref();
    }
};

// ── Tests ──

const constants = @import("constants");

test {
    _ = @import("store_test.zig");
}
