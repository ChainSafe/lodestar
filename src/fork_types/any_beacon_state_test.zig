//! Tests for `any_beacon_state.zig`.

const std = @import("std");
const expect = std.testing.expect;
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const BeaconState = @import("./beacon_state.zig").BeaconState;
const AnyBeaconState = @import("any_beacon_state.zig").AnyBeaconState;

test "Heze state wrappers reject removed legacy fields" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    var state = try AnyBeaconState.fromValue(allocator, &pool, .heze, &ct.heze.BeaconState.default_value);
    defer state.deinit();
    try std.testing.expectError(error.InvalidAtFork, state.eth1Data());
    try std.testing.expectError(error.InvalidAtFork, state.eth1DataVotes());
    try std.testing.expectError(error.InvalidAtFork, state.eth1DepositIndex());
    try std.testing.expectError(error.InvalidAtFork, state.depositRequestsStartIndex());
    try std.testing.expectError(error.InvalidAtFork, state.resetEth1DataVotes());
    try std.testing.expectError(error.InvalidAtFork, state.setDepositRequestsStartIndex(0));
    const typed = state.castToFork(.heze);
    try std.testing.expectError(error.InvalidAtFork, typed.eth1Data());
    try std.testing.expectError(error.InvalidAtFork, typed.eth1DataVotes());
    try std.testing.expectError(error.InvalidAtFork, typed.eth1DepositIndex());
    try std.testing.expectError(error.InvalidAtFork, typed.depositRequestsStartIndex());
}

fn expectListRoot(comptime List: type, value: *const List.Type, actual: *const [32]u8) !void {
    var expected: [32]u8 = undefined;
    try List.hashTreeRoot(std.testing.allocator, value, &expected);
    try std.testing.expectEqualSlices(u8, &expected, actual);
}

test "electra - sanity" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var beacon_state = try AnyBeaconState.fromValue(allocator, &pool, .electra, &ct.electra.BeaconState.default_value);
    defer beacon_state.deinit();

    try beacon_state.setSlot(12345);

    try std.testing.expect((try beacon_state.genesisTime()) == 0);
    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 32, (try beacon_state.genesisValidatorsRoot())[0..]);
    try std.testing.expect((try beacon_state.slot()) == 12345);
    try beacon_state.setSlot(2025);
    try std.testing.expect((try beacon_state.slot()) == 2025);

    const out: *const [32]u8 = try beacon_state.hashTreeRoot();
    try expect(!std.mem.eql(u8, (&[_]u8{0} ** 32)[0..], out.*[0..]));

    // TODO: more tests
}

test "clone - sanity" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var beacon_state = try AnyBeaconState.fromValue(allocator, &pool, .electra, &ct.electra.BeaconState.default_value);
    defer beacon_state.deinit();

    try beacon_state.setSlot(12345);
    try beacon_state.commit();

    // test the clone() and deinit() works fine without memory leak
    var cloned_state = try beacon_state.clone(.{});
    defer cloned_state.deinit();

    try expect((try cloned_state.slot()) == 12345);
}

test "clone - cases" {
    const allocator = std.testing.allocator;

    const TestCase = struct {
        name: []const u8,
        slot_set: u64,
        commit_before_clone: bool,
        expected_slot: u64,
    };

    const test_Case = [_]TestCase{
        .{ .name = "commit before clone", .slot_set = 12345, .commit_before_clone = true, .expected_slot = 12345 },
        .{ .name = "no commit before clone", .slot_set = 12345, .commit_before_clone = false, .expected_slot = 0 },
    };

    inline for (test_Case) |tc| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
        defer pool.deinit();

        var beacon_state = try AnyBeaconState.fromValue(allocator, &pool, .electra, &ct.electra.BeaconState.default_value);
        defer beacon_state.deinit();

        try beacon_state.setSlot(tc.slot_set);
        try expect((try beacon_state.slot()) == tc.slot_set);

        if (tc.commit_before_clone) {
            try beacon_state.commit();
        }

        var cloned_state = try beacon_state.clone(.{});
        defer cloned_state.deinit();

        const got = try cloned_state.slot();
        if (got != tc.expected_slot) {
            std.debug.print("clone case '{s}' failed: got slot {}, expected {}\n", .{ tc.name, got, tc.expected_slot });
            return error.TestExpectedEqual;
        }
    }
}

test "upgrade state - sanity" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var phase0_state = try AnyBeaconState.fromValue(allocator, &pool, .phase0, &ct.phase0.BeaconState.default_value);
    defer phase0_state.deinit();

    var altair_state = try phase0_state.upgradeUnsafe();
    defer altair_state.deinit();
    try expect(altair_state.forkSeq() == .altair);

    var bellatrix_state = try altair_state.upgradeUnsafe();
    defer bellatrix_state.deinit();
    try expect(bellatrix_state.forkSeq() == .bellatrix);

    var capella_state = try bellatrix_state.upgradeUnsafe();
    defer capella_state.deinit();
    try expect(capella_state.forkSeq() == .capella);

    var deneb_state = try capella_state.upgradeUnsafe();
    defer deneb_state.deinit();
    try expect(deneb_state.forkSeq() == .deneb);

    var electra_state = try deneb_state.upgradeUnsafe();
    defer electra_state.deinit();
    try expect(electra_state.forkSeq() == .electra);

    var fulu_state = try electra_state.upgradeUnsafe();
    defer fulu_state.deinit();
    try expect(fulu_state.forkSeq() == .fulu);

    var gloas_state = try fulu_state.upgradeUnsafe();
    defer gloas_state.deinit();
    try expect(gloas_state.forkSeq() == .gloas);
}

test "single proof: validators[0].withdrawal_credentials" {
    const allocator = std.testing.allocator;
    const ssz = @import("ssz");
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var beacon_state = try AnyBeaconState.fromValue(
        allocator,
        &pool,
        .electra,
        &ct.electra.BeaconState.default_value,
    );
    defer beacon_state.deinit();

    // Bootstrap one validator so `validators[0]` exists.
    var validators_view = try beacon_state.validators();
    const validator_value = ct.electra.Validator.Type{
        .pubkey = [_]u8{1} ** 48,
        .withdrawal_credentials = [_]u8{0xab} ** 32,
        .effective_balance = 32_000_000_000,
        .slashed = false,
        .activation_eligibility_epoch = 0,
        .activation_epoch = 0,
        .exit_epoch = std.math.maxInt(u64),
        .withdrawable_epoch = std.math.maxInt(u64),
    };
    try validators_view.pushValue(&validator_value);
    try beacon_state.commit();

    const gindex = ssz.getPathGindex(ct.electra.BeaconState, "validators.0.withdrawal_credentials");
    var proof = try beacon_state.getSingleProof(allocator, @intFromEnum(gindex));
    defer proof.deinit(allocator);

    // The proof should be non-empty and the leaf should match the value
    // we set above. (We do not yet verify witness chain correctness — just
    // that proof generation does not error out with InvalidNode.)
    try std.testing.expect(proof.witnesses.len > 0);
    try std.testing.expectEqualSlices(u8, &[_]u8{0xab} ** 32, &proof.leaf);
}

test "single proof: balances[0]" {
    const allocator = std.testing.allocator;
    const ssz = @import("ssz");
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var beacon_state = try AnyBeaconState.fromValue(
        allocator,
        &pool,
        .electra,
        &ct.electra.BeaconState.default_value,
    );
    defer beacon_state.deinit();

    var balances_view = try beacon_state.balances();
    try balances_view.push(31_000_000_000);
    try beacon_state.commit();

    const gindex = ssz.getPathGindex(ct.electra.BeaconState, "balances.0");
    var proof = try beacon_state.getSingleProof(allocator, @intFromEnum(gindex));
    defer proof.deinit(allocator);

    try std.testing.expect(proof.witnesses.len > 0);
    // balances[0] is a packed u64; only the low 8 bytes of the leaf carry
    // the value (LE-encoded), the rest of the chunk is zero-padded.
    var expected_leaf: [32]u8 = [_]u8{0} ** 32;
    std.mem.writeInt(u64, expected_leaf[0..8], 31_000_000_000, .little);
    try std.testing.expectEqualSlices(u8, &expected_leaf, &proof.leaf);
}

test "state lists retain fork tags and preserve borrowed mutations and concrete roots" {
    const ForkSeq = @import("config").ForkSeq;
    const ForkTypes = @import("fork_types.zig").ForkTypes;
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    inline for (comptime std.meta.tags(ForkSeq)) |fork| {
        const State = ForkTypes(fork).BeaconState;
        {
            var state = try AnyBeaconState.fromValue(allocator, &pool, fork, &State.default_value);
            defer state.deinit();
            const validators = try state.validators();
            const balances = try state.balances();
            try std.testing.expectEqual(fork, validators.forkSeq());
            try std.testing.expectEqual(fork, balances.forkSeq());
            try std.testing.expectEqual(try state.castToFork(fork).inner.get("validators"), try validators.unwrap(State.getFieldType("validators")));
            try std.testing.expectEqual(try state.castToFork(fork).inner.get("balances"), try balances.unwrap(State.getFieldType("balances")));
            try validators.pushValue(&ct.phase0.Validator.default_value);
            try balances.push(123);
            try std.testing.expectEqual(@as(usize, 1), try state.validatorsCount());
            try std.testing.expectEqual(@as(u64, 123), try (try state.balances()).get(0));

            var expected_validators = State.getFieldType("validators").default_value;
            defer expected_validators.deinit(allocator);
            try expected_validators.append(allocator, ct.phase0.Validator.default_value);
            try expectListRoot(State.getFieldType("validators"), &expected_validators, try validators.hashTreeRoot());
            var iterator = validators.iteratorReadonly(0);
            try std.testing.expectEqualDeep(ct.phase0.Validator.default_value, (try iterator.nextValuePtr()).*);

            var expected_balances = State.getFieldType("balances").default_value;
            defer expected_balances.deinit(allocator);
            try expected_balances.append(allocator, 123);
            try expectListRoot(State.getFieldType("balances"), &expected_balances, try balances.hashTreeRoot());

            if (comptime fork.gte(.altair)) {
                const previous = try state.previousEpochParticipation();
                const current = try state.currentEpochParticipation();
                const scores = try state.inactivityScores();
                try previous.push(1);
                try current.push(2);
                try scores.push(3);
                try std.testing.expectEqual(@as(u8, 1), try (try state.previousEpochParticipation()).get(0));
                try std.testing.expectEqual(@as(u8, 2), try (try state.currentEpochParticipation()).get(0));
                try std.testing.expectEqual(@as(u64, 3), try (try state.inactivityScores()).get(0));

                var previous_value: ct.altair.EpochParticipation.Type = .empty;
                defer previous_value.deinit(allocator);
                try previous_value.appendSlice(allocator, &.{ 1, 2, 4 });
                var current_value: ct.altair.EpochParticipation.Type = .empty;
                defer current_value.deinit(allocator);
                try current_value.appendSlice(allocator, &.{ 6, 5 });
                try state.setPreviousEpochParticipation(&previous_value);
                try state.setCurrentEpochParticipation(&current_value);
                const updated_previous = try state.previousEpochParticipation();
                const updated_current = try state.currentEpochParticipation();
                try std.testing.expectEqual(fork, updated_previous.forkSeq());
                try std.testing.expectEqual(fork, updated_current.forkSeq());
                try std.testing.expectEqual(previous_value.items.len, try updated_previous.length());
                try std.testing.expectEqual(current_value.items.len, try updated_current.length());
                try expectListRoot(State.getFieldType("previous_epoch_participation"), &previous_value, try updated_previous.hashTreeRoot());
                try expectListRoot(State.getFieldType("current_epoch_participation"), &current_value, try updated_current.hashTreeRoot());
            } else {
                try std.testing.expectError(error.InvalidAtFork, state.previousEpochParticipation());
                try std.testing.expectError(error.InvalidAtFork, state.currentEpochParticipation());
                try std.testing.expectError(error.InvalidAtFork, state.inactivityScores());
                try std.testing.expectError(error.InvalidAtFork, state.setPreviousEpochParticipation(&ct.altair.EpochParticipation.default_value));
                try std.testing.expectError(error.InvalidAtFork, state.setCurrentEpochParticipation(&ct.altair.EpochParticipation.default_value));
            }

            if (comptime fork.gte(.electra)) {
                {
                    const copy = try (try state.pendingDeposits()).clone(.{ .transfer_cache = false });
                    errdefer copy.deinit();
                    try std.testing.expectEqual(fork, copy.forkSeq());
                    try copy.pushValue(&ct.electra.PendingDeposit.default_value);
                    try state.setPendingDeposits(copy);
                }
                {
                    const copy = try (try state.pendingPartialWithdrawals()).clone(.{ .transfer_cache = false });
                    errdefer copy.deinit();
                    try copy.pushValue(&ct.electra.PendingPartialWithdrawal.default_value);
                    try state.setPendingPartialWithdrawals(copy);
                }
                {
                    const copy = try (try state.pendingConsolidations()).clone(.{ .transfer_cache = false });
                    errdefer copy.deinit();
                    try copy.pushValue(&ct.electra.PendingConsolidation.default_value);
                    try state.setPendingConsolidations(copy);
                }
                try std.testing.expectEqual(@as(usize, 1), try (try state.pendingDeposits()).length());
                try std.testing.expectEqual(@as(usize, 1), try (try state.pendingPartialWithdrawals()).length());
                try std.testing.expectEqual(@as(usize, 1), try (try state.pendingConsolidations()).length());
            } else {
                try std.testing.expectError(error.InvalidAtFork, state.pendingDeposits());
                try std.testing.expectError(error.InvalidAtFork, state.pendingPartialWithdrawals());
                try std.testing.expectError(error.InvalidAtFork, state.pendingConsolidations());
            }
            try state.commit();
        }
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}

test "list views reject incompatible transfer without consuming either owner" {
    const Deposits = @import("any_state_list.zig").AnyStateList("pending_deposits");
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var state = try AnyBeaconState.fromValue(allocator, &pool, .fulu, &ct.fulu.BeaconState.default_value);
        defer state.deinit();
        const before = (try state.hashTreeRoot()).*;
        const view = try ct.gloas.PendingDeposits.TreeView.fromValue(allocator, &pool, &ct.gloas.PendingDeposits.default_value);
        const deposits = Deposits.fromView(.gloas, view);
        defer deposits.deinit();
        try std.testing.expectEqual(@import("config").ForkSeq.gloas, deposits.forkSeq());
        try deposits.pushValue(&ct.electra.PendingDeposit.default_value);
        try std.testing.expectError(error.IncompatibleListType, deposits.unwrap(ct.electra.PendingDeposits));
        try std.testing.expectError(error.InvalidAtFork, state.setPendingDeposits(deposits));
        try std.testing.expectEqual(@as(usize, 1), try deposits.length());
        try std.testing.expectEqualSlices(u8, &before, try state.hashTreeRoot());

        var electra = try AnyBeaconState.fromValue(allocator, &pool, .electra, &ct.electra.BeaconState.default_value);
        defer electra.deinit();
        try (try electra.pendingDeposits()).pushValue(&ct.electra.PendingDeposit.default_value);
        try electra.commit();
        {
            const copy = try (try electra.pendingDeposits()).sliceTo(0);
            errdefer copy.deinit();
            try std.testing.expectEqual(@import("config").ForkSeq.electra, copy.forkSeq());
            try state.setPendingDeposits(copy);
        }
        try std.testing.expectEqual(@as(usize, 1), try (try state.pendingDeposits()).length());
        try std.testing.expectEqual(@import("config").ForkSeq.fulu, (try state.pendingDeposits()).forkSeq());
        try (try state.pendingDeposits()).pushValue(&ct.electra.PendingDeposit.default_value);
        try std.testing.expectEqual(@as(usize, 1), try (try electra.pendingDeposits()).length());
        try std.testing.expectEqual(@as(usize, 2), try (try state.pendingDeposits()).length());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
