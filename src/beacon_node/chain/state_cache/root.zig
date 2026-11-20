//! Lodestar currently keeps two state caches around.
//!  1. `BlockStateCache` is keyed by state root, and intended to keep extremely recent states around
//!     (e.g. post states from the latest blocks). These states are most likely to be useful for state
//!     transition of new blocks.
//!  2. `PersistentCheckpointStateCache` is keyed by checkpoint, and intended to keep states which have
//!     just undergone an epoch transition. These states are useful for gossip verification and for
//!     avoiding an epoch transition during state transition of first-in-epoch blocks.

const std = @import("std");
const testing = std.testing;

pub const key = @import("key.zig");
pub const block_state_cache = @import("block_state_cache.zig");
pub const cp_datastore = @import("cp_datastore.zig");
pub const metrics = @import("metrics.zig");

pub const CheckpointContext = key.CheckpointContext;
pub const DatastoreKey = key.DatastoreKey;
pub const datastoreKey = key.datastoreKey;
pub const Checkpoint = key.Checkpoint;

pub const BlockStateCache = block_state_cache.BlockStateCache;
pub const DEFAULT_MAX_BLOCK_STATES = block_state_cache.DEFAULT_MAX_BLOCK_STATES;

pub const CPStateDatastore = cp_datastore.CPStateDatastore;
pub const InMemoryCPStateDatastore = cp_datastore.InMemoryCPStateDatastore;
pub const FileCPStateDatastore = cp_datastore.FileCPStateDatastore;

test {
    testing.refAllDecls(@This());
}
