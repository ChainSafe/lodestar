const std = @import("std");
const Allocator = std.mem.Allocator;
const getBlockRootFn = @import("../utils/block_root.zig").getBlockRoot;
const getBlockRootAtSlotFn = @import("../utils/block_root.zig").getBlockRootAtSlot;
const types = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const Checkpoint = types.phase0.Checkpoint.Type;
const Epoch = types.primitive.Epoch.Type;
const Slot = types.primitive.Slot.Type;
const Root = types.primitive.Root.Type;

pub fn RootCache(comptime fork: ForkSeq) type {
    return struct {
        allocator: Allocator,
        current_justified_checkpoint: Checkpoint,
        previous_justified_checkpoint: Checkpoint,
        state: *BeaconState(fork),
        block_root_epoch_cache: std.AutoHashMap(Epoch, *const Root),
        block_root_slot_cache: std.AutoHashMap(Slot, *const Root),

        const Self = @This();

        pub fn init(allocator: Allocator, state: *BeaconState(fork)) !*Self {
            const instance = try allocator.create(Self);
            errdefer allocator.destroy(instance);

            var current_justified_checkpoint: Checkpoint = undefined;
            var previous_justified_checkpoint: Checkpoint = undefined;
            try state.currentJustifiedCheckpoint(&current_justified_checkpoint);
            try state.previousJustifiedCheckpoint(&previous_justified_checkpoint);
            instance.* = Self{
                .allocator = allocator,
                .current_justified_checkpoint = current_justified_checkpoint,
                .previous_justified_checkpoint = previous_justified_checkpoint,
                .state = state,
                .block_root_epoch_cache = std.AutoHashMap(Epoch, *const Root).init(allocator),
                .block_root_slot_cache = std.AutoHashMap(Slot, *const Root).init(allocator),
            };

            return instance;
        }

        pub fn getBlockRoot(self: *Self, epoch: Epoch) !*const Root {
            if (self.block_root_epoch_cache.get(epoch)) |root| {
                return root;
            } else {
                const root = try getBlockRootFn(fork, self.state, epoch);
                try self.block_root_epoch_cache.put(epoch, root);
                return root;
            }
        }

        pub fn getBlockRootAtSlot(self: *Self, slot: Slot) !*const Root {
            if (self.block_root_slot_cache.get(slot)) |root| {
                return root;
            } else {
                const root = try getBlockRootAtSlotFn(fork, self.state, slot);
                try self.block_root_slot_cache.put(slot, root);
                return root;
            }
        }

        pub fn deinit(self: *Self) void {
            self.block_root_epoch_cache.deinit();
            self.block_root_slot_cache.deinit();
            self.allocator.destroy(self);
        }
    };
}
// TODO: unit tests
