const std = @import("std");
const Allocator = std.mem.Allocator;
const DynamicBitSet = std.DynamicBitSet;
const types = @import("consensus_types");
const Slot = types.primitive.Slot.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const Validator = types.phase0.Validator.Type;

/// Cache of slashed validator indices with an initialization slot.
pub const SlashingsCache = struct {
    latest_block_slot: ?Slot,
    slashed_validators: DynamicBitSet,

    pub fn initEmpty(allocator: Allocator) !SlashingsCache {
        return .{
            .latest_block_slot = null,
            .slashed_validators = try DynamicBitSet.initEmpty(allocator, 0),
        };
    }

    pub fn initFromValidators(
        allocator: Allocator,
        latest_block_slot: Slot,
        validators: []const *const Validator,
    ) !SlashingsCache {
        var slashed_validators = try DynamicBitSet.initEmpty(allocator, validators.len);
        errdefer slashed_validators.deinit();
        for (validators, 0..) |validator, i| {
            if (validator.slashed) {
                slashed_validators.set(i);
            }
        }

        return .{
            .latest_block_slot = latest_block_slot,
            .slashed_validators = slashed_validators,
        };
    }

    pub fn clone(self: *const SlashingsCache, allocator: Allocator) !SlashingsCache {
        var slashed_validators = try self.slashed_validators.clone(allocator);
        errdefer slashed_validators.deinit();

        return .{
            .latest_block_slot = self.latest_block_slot,
            .slashed_validators = slashed_validators,
        };
    }

    pub fn deinit(self: *SlashingsCache) void {
        self.slashed_validators.deinit();
        self.* = undefined;
    }

    pub fn isInitialized(self: *const SlashingsCache, latest_block_slot: Slot) bool {
        return self.latest_block_slot != null and self.latest_block_slot.? == latest_block_slot;
    }

    pub fn checkInitialized(self: *const SlashingsCache, latest_block_slot: Slot) !void {
        if (self.isInitialized(latest_block_slot)) return;
        return error.SlashingsCacheUninitialized;
    }

    pub fn recordValidatorSlashing(self: *SlashingsCache, block_slot: Slot, validator_index: ValidatorIndex) !void {
        try self.checkInitialized(block_slot);
        const idx: usize = @intCast(validator_index);
        if (idx >= self.slashed_validators.capacity()) {
            try self.slashed_validators.resize(idx + 1, false);
        }
        self.slashed_validators.set(idx);
    }

    pub fn isSlashed(self: *const SlashingsCache, validator_index: ValidatorIndex) bool {
        const idx: usize = @intCast(validator_index);
        if (idx >= self.slashed_validators.capacity()) return false;
        return self.slashed_validators.isSet(idx);
    }

    pub fn updateLatestBlockSlot(self: *SlashingsCache, latest_block_slot: Slot) void {
        self.latest_block_slot = latest_block_slot;
    }
};

/// Rebuilds the cache if it's not initialized for the state's latest block slot.
pub fn buildFromStateIfNeeded(
    allocator: Allocator,
    state: anytype,
    slashings_cache: *SlashingsCache,
) !void {
    var latest_block_header = try state.latestBlockHeader();
    const latest_block_slot = try latest_block_header.get("slot");
    if (slashings_cache.isInitialized(latest_block_slot)) return;

    const validators = try state.validatorsPtrSlice(allocator);
    defer allocator.free(validators);
    var new_cache = try SlashingsCache.initFromValidators(allocator, latest_block_slot, validators);
    errdefer new_cache.deinit();
    slashings_cache.deinit();
    slashings_cache.* = new_cache;
}

test {
    _ = @import("slashings_cache_test.zig");
}
