const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const c = @import("constants");
const PubkeyHashContext = @import("../cache/pubkey_cache.zig").PubkeyHashContext;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;

/// Valid only within one block while registry mutations go through addBuilder.
/// Top-ups may invalidate reuse candidates, so candidates are checked again before reuse.
pub fn IndexedBuilderState(comptime fork: ForkSeq) type {
    return struct {
        const Self = @This();

        allocator: std.mem.Allocator,
        state: *BeaconState(fork),
        epoch: u64,
        context: PubkeyHashContext,
        index_by_pubkey: std.array_hash_map.Custom([48]u8, usize, PubkeyHashContext, true) = .empty,
        reuse_candidates: std.ArrayList(usize) = .empty,
        reuse_cursor: usize = 0,

        pub fn init(allocator: std.mem.Allocator, io: std.Io, state: *BeaconState(fork)) !Self {
            var self: Self = .{
                .allocator = allocator,
                .state = state,
                .epoch = computeEpochAtSlot(try state.slot()),
                .context = .{ .hash_key = undefined },
            };
            errdefer self.deinit();
            io.random(&self.context.hash_key);
            var builders = try state.inner.get("builders");
            try builders.commit();
            const len = try builders.length();
            try self.index_by_pubkey.ensureTotalCapacityContext(allocator, len, self.context);
            var it = builders.iteratorReadonly(0);
            for (0..len) |index| {
                const builder = try it.nextValue();
                self.index_by_pubkey.putAssumeCapacityContext(builder.pubkey, index, self.context);
                if (canReuse(&builder, self.epoch)) try self.reuse_candidates.append(allocator, index);
            }
            return self;
        }

        pub fn deinit(self: *Self) void {
            self.index_by_pubkey.deinit(self.allocator);
            self.reuse_candidates.deinit(self.allocator);
        }

        pub fn find(self: *const Self, pubkey: *const [48]u8) ?usize {
            return self.index_by_pubkey.getContext(pubkey.*, self.context);
        }

        pub fn addBuilder(self: *Self, pubkey: *const [48]u8, address: *const [20]u8, amount: u64) !void {
            const builder = ForkTypes(fork).Builder.Type{
                .pubkey = pubkey.*,
                .version = c.PAYLOAD_BUILDER_VERSION,
                .execution_address = address.*,
                .balance = amount,
                .deposit_epoch = self.epoch,
                .withdrawable_epoch = c.FAR_FUTURE_EPOCH,
            };
            var builders = try self.state.inner.get("builders");
            try self.index_by_pubkey.ensureUnusedCapacityContext(self.allocator, 1, self.context);
            while (self.reuse_cursor < self.reuse_candidates.items.len) {
                const index = self.reuse_candidates.items[self.reuse_cursor];
                self.reuse_cursor += 1;
                var old: ForkTypes(fork).Builder.Type = undefined;
                try builders.getValue(undefined, index, &old);
                if (!canReuse(&old, self.epoch)) continue;
                try builders.setValue(index, &builder);
                _ = self.index_by_pubkey.swapRemoveContext(old.pubkey, self.context);
                self.index_by_pubkey.putAssumeCapacityContext(pubkey.*, index, self.context);
                return;
            }
            const index = try builders.length();
            try builders.pushValue(&builder);
            self.index_by_pubkey.putAssumeCapacityContext(pubkey.*, index, self.context);
        }

        fn canReuse(builder: *const ForkTypes(fork).Builder.Type, epoch: u64) bool {
            return builder.withdrawable_epoch <= epoch and builder.balance == 0;
        }
    };
}

test {
    _ = @import("indexed_builder_state_test.zig");
}
