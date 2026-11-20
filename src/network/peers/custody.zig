const std = @import("std");
const PeerId = @import("types.zig").PeerId;
const discv5 = @import("discv5");
pub const Groups = std.StaticBitSet(128);
pub const hashes_max: u16 = 4096;
pub const hashes_per_row: u16 = 64;
pub const hashes_per_turn: u16 = 256;
pub const Config = struct {
    groups: u16,
    columns: u16,

    pub fn validate(self: Config) error{InvalidConfig}!void {
        if (self.groups == 0 or self.groups > 128 or self.columns == 0 or
            self.columns > 128 or self.columns % self.groups != 0) return error.InvalidConfig;
    }
    pub fn columnsForGroup(self: Config, group: u16, out: []u16) !usize {
        try self.validate();
        if (group >= self.groups) return error.InvalidGroup;
        const count = self.columns / self.groups;
        if (out.len < count) return error.OutputTooSmall;
        for (out[0..count], 0..) |*column, i| column.* = @as(u16, @intCast(i)) * self.groups + group;
        return count;
    }
};
pub const Derivation = struct {
    current_id: u256,
    config: Config,
    requested: u16,
    hashes: u16 = 0,
    groups: Groups = .empty,
    exhausted: bool = false,

    pub fn init(node_id: *const [32]u8, config: Config, count: u64) !Derivation {
        try config.validate();
        if (count > config.groups) return error.InvalidCount;
        var result: Derivation = .{
            .current_id = std.mem.readInt(u256, node_id, .big),
            .config = config,
            .requested = @intCast(count),
        };
        if (count == config.groups) result.groups.setRangeValue(.{ .start = 0, .end = config.groups }, true);
        return result;
    }
    /// Partial groups are never returned. WorkLimit permanently discards this derivation.
    pub fn step(self: *Derivation, budget: u16) error{WorkLimit}!?Groups {
        std.debug.assert(budget <= hashes_per_row);
        if (self.exhausted) return error.WorkLimit;
        if (self.groups.count() == self.requested) return self.groups;
        for (0..budget) |_| {
            if (self.hashes == hashes_max) break;
            var bytes: [32]u8 = undefined;
            std.mem.writeInt(u256, &bytes, self.current_id, .little);
            var digest: [32]u8 = undefined;
            std.crypto.hash.sha2.Sha256.hash(&bytes, &digest, .{});
            self.hashes += 1;
            self.current_id +%= 1;
            self.groups.set(@intCast(std.mem.readInt(u64, digest[0..8], .little) % self.config.groups));
            if (self.groups.count() == self.requested) return self.groups;
        }
        if (self.hashes == hashes_max) {
            self.groups = .empty;
            self.exhausted = true;
            return error.WorkLimit;
        }
        return null;
    }
};

pub const Derived = struct { custody: Groups, sampling: Groups };
pub const SamplingDerivation = struct {
    walk: Derivation,
    custody_count: u16,
    sampling_count: u16,
    checkpoint: ?Groups = null,

    pub fn init(node_id: *const [32]u8, config: Config, custody_count: u64, minimum_sampling_groups: u16) !SamplingDerivation {
        const walk = try Derivation.init(node_id, config, custody_count);
        if (minimum_sampling_groups > config.groups) return error.InvalidCount;
        var result: SamplingDerivation = .{
            .walk = walk,
            .custody_count = @intCast(custody_count),
            .sampling_count = @max(@as(u16, @intCast(custody_count)), minimum_sampling_groups),
        };
        _ = try result.step(0);
        return result;
    }

    pub fn step(self: *SamplingDerivation, budget: u16) error{WorkLimit}!?Derived {
        std.debug.assert(budget <= hashes_per_row);
        const before = self.totalHashes();
        if (self.checkpoint == null) {
            self.checkpoint = try self.walk.step(budget);
            if (self.checkpoint == null) return null;
            self.walk.requested = self.sampling_count;
            if (self.sampling_count == self.walk.config.groups)
                self.walk.groups.setRangeValue(.{ .start = 0, .end = self.walk.config.groups }, true);
        }
        _ = self.walk.step(budget - (self.totalHashes() - before)) catch |err| {
            self.checkpoint = null;
            return err;
        };
        return self.complete();
    }

    pub fn complete(self: *const SamplingDerivation) ?Derived {
        if (self.exhausted() or self.walk.groups.count() != self.sampling_count) return null;
        return .{ .custody = self.checkpoint orelse return null, .sampling = self.walk.groups };
    }

    pub fn totalHashes(self: *const SamplingDerivation) u16 {
        return self.walk.hashes;
    }

    pub fn exhausted(self: *const SamplingDerivation) bool {
        return self.walk.exhausted;
    }
};

pub fn nodeId(identity: *const PeerId) ![32]u8 {
    const key = try identity.publicKey();
    const uncompressed = try discv5.identity.crypto.uncompressedPublicKey(&key.bytes);
    var result: [32]u8 = undefined;
    std.crypto.hash.sha3.Keccak256.hash(uncompressed[1..], &result, .{});
    return result;
}
test {
    _ = @import("custody_test.zig");
}
