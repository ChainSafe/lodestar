const std = @import("std");
const types = @import("consensus_types");
const phase0 = types.phase0;

const Epoch = types.primitive.Epoch.Type;

/// The persisted key: serialized data of a checkpoint (the SSZ serialization of `phase0.Checkpoint`).
pub const DATASTORE_KEY_LEN = phase0.Checkpoint.fixed_size;
pub const DatastoreKey = [DATASTORE_KEY_LEN]u8;

/// The spec `phase0.Checkpoint`, reused directly as the checkpoint-state cache map key.
pub const Checkpoint = phase0.Checkpoint.Type;

/// Roots are SHA-256 outputs, so the low 8 bytes are uniformly distributed; xor the epoch in.
pub const CheckpointContext = struct {
    pub fn hash(_: CheckpointContext, cp: Checkpoint) u64 {
        const root_part = std.mem.readInt(u64, cp.root[0..8], .little);
        return root_part ^ cp.epoch;
    }
    pub fn eql(_: CheckpointContext, a: Checkpoint, b: Checkpoint) bool {
        return a.epoch == b.epoch and std.mem.eql(u8, &a.root, &b.root);
    }
};

pub fn datastoreKey(cp: Checkpoint) DatastoreKey {
    var out: DatastoreKey = undefined;
    const n = phase0.Checkpoint.serializeIntoBytes(&cp, &out);
    std.debug.assert(n == DATASTORE_KEY_LEN);
    return out;
}

pub fn checkpointFromDatastoreKey(dk: DatastoreKey) Checkpoint {
    var out: Checkpoint = undefined;
    // `dk` is exactly `fixed_size` bytes, so deserialize's only error (a length mismatch) cannot
    // fire; the u64/Bytes32 fields have no invalid bit patterns either.
    phase0.Checkpoint.deserializeFromBytes(&dk, &out) catch unreachable;
    return out;
}

/// Epoch is the first SSZ field, so it sits at offset 0.
pub fn datastoreKeyEpoch(dk: DatastoreKey) Epoch {
    return std.mem.readInt(u64, dk[0..8], .little);
}

test "datastoreKey round-trips a checkpoint" {
    const cp = Checkpoint{ .root = [_]u8{0xab} ** 32, .epoch = 0x1122334455667788 };
    const dk = datastoreKey(cp);
    try std.testing.expectEqual(@as(u8, 0x88), dk[0]);
    try std.testing.expectEqual(@as(u8, 0xab), dk[8]);
    try std.testing.expectEqual(cp.epoch, datastoreKeyEpoch(dk));

    const back = checkpointFromDatastoreKey(dk);
    try std.testing.expectEqual(cp.epoch, back.epoch);
    try std.testing.expectEqualSlices(u8, &cp.root, &back.root);
}
