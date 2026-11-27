const NetworkCore = @import("../network_core.zig").NetworkCore;
const Population = @import("../peers/population.zig").Population;
const Now = @import("../types.zig").Now;
const processor_metrics = @import("processor.zig");

/// Borrowed only on the network owner while it is not advancing protocol state.
pub const Context = struct {
    owner: *const NetworkCore,
    now: Now,
    expired_executing: usize = 0,
    /// The host processor state, copied under its runtime mutex. Null renders zeros.
    processor: ?*const processor_metrics.Snapshot = null,
    population: Population = .{},
    /// Kernel drop totals per family of the QUIC and discovery UDP sockets. Reading them extends
    /// each socket's 32-bit kernel count, so `init` takes the owner mutably.
    socket_drops: [2][2]?u64 = @splat(@splat(null)),

    pub fn init(owner: *NetworkCore, now: Now) Context {
        var result: Context = .{ .owner = owner, .now = now };
        result.socket_drops[0] = owner.transport.sockets.drops();
        if (owner.discovery) |discovery| result.socket_drops[1] = discovery.transport.sockets.drops();
        result.population = .collect(&owner.peer_manager.catalog, owner.protocols.gossipsub, now.millis());
        return result;
    }
};
