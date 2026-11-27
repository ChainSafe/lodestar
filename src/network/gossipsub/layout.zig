const gossip_limits = @import("../gossip_limits.zig");
const constants = @import("constants.zig");
const storage = @import("message_store.zig");
const delivery = @import("delivery.zig");
const policy = @import("topic_policy.zig");
const Options = @import("options.zig").Options;
const PeerIo = @import("peer_io.zig").PeerIo;
const Gossipsub = @import("Gossipsub.zig");
const sessions_mod = @import("sessions.zig");
const overlay = @import("overlay.zig");
const messages = @import("messages.zig");
const recovery = @import("recovery.zig");

pub const Plan = struct {
    retained_bytes: usize,
    page_count: usize,
    message_entries: usize,
    validation_capacity: usize,
    data_descriptors_per_peer: usize,
    data_descriptors_reserved_per_peer: usize,
    page_bytes: usize,
    frame_bytes: usize,
    compression_bytes: usize,
    peer_buffer_bytes: usize,
    metadata_bytes: usize,
    total_bytes: usize,
};

/// Derives physical storage from configured concurrency. Per-peer byte limits
/// charge logical obligations; they do not multiply the shared payload budget.
pub const Layout = struct {
    sessions: u16,
    connection_slots: u16,
    retained: u16,
    topics: u16,
    history: usize,
    seen: usize,
    validations: usize,
    fingerprints: usize,
    payload_entries: usize,
    payload_bytes: usize,
    deliveries: usize,
    receive_arena_bytes: usize,
    session_buffer_bytes: usize,
    namespace_bytes: usize,

    pub fn init(options: *const Options) Layout {
        const active_limits = options.activeSendLimits();
        const active = activeBacking(&active_limits, options.connected_capacity);
        return .{
            .sessions = options.connected_capacity,
            .connection_slots = options.connection_slots,
            .retained = options.retained_capacity,
            .topics = residentTopics(options),
            .history = historyCapacity(options),
            .seen = options.seen_capacity,
            .validations = options.validation_capacity,
            .fingerprints = 4 * options.validation_capacity,
            .payload_entries = historyCapacity(options) + options.validation_capacity + active.items,
            .payload_bytes = options.mcache_arena_bytes / storage.page_bytes * storage.page_bytes + active.bytes,
            .deliveries = delivery.Pool.capacity(options.connected_capacity, options.validation_capacity),
            .receive_arena_bytes = options.receive_arena_bytes,
            .session_buffer_bytes = PeerIo.bufferBytes(options),
            .namespace_bytes = policy.Namespace.backingBytes(options.topic_policy),
        };
    }

    // Each session owns at most one frame. Noncanonical Snappy can exceed the usual
    // compressed size for its topic, so reserve against aggregate byte allowances.
    fn activeBacking(limits: *const gossip_limits.Limits, sessions: u16) struct { items: usize, bytes: usize } {
        const items = @min(sessions, gossip_limits.items(limits));
        const maximum = storage.Store.pagesFor(constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE)) * storage.page_bytes;
        return .{ .items = items, .bytes = @min(gossip_limits.bytes(limits), items * maximum) };
    }

    pub fn residentTopics(options: *const Options) u16 {
        return policy.validate(options.topic_policy) catch unreachable;
    }

    /// The history must hold every message retained in its six windows, publications included,
    /// or it evicts messages peers can still request. With processor limits, their per-kind
    /// allowances bound what it can retain, so it covers their total, which validation capacity
    /// equals and which stays below the history's ceiling. A node on every attestation subnet can
    /// retain a whole slot of attestations within six windows.
    fn historyCapacity(options: *const Options) usize {
        return if (options.payload_limits != null) @max(options.mcache_capacity, options.validation_capacity) else options.mcache_capacity;
    }

    pub fn plan(self: *const Layout) Plan {
        const peers = @import("peer_book.zig");
        const metadata = @sizeOf(Gossipsub) +
            @sizeOf(sessions_mod.Sessions) + @sizeOf(overlay.Overlay) +
            sessions_mod.Sessions.metadataBytes(self) +
            peers.PeerBook.backingBytesForTopics(self.retained, self.topics) +
            @as(usize, self.topics) * (@sizeOf(overlay.Row) + @sizeOf(u16)) +
            messages.Messages.metadataBytes(self) +
            recovery.Recovery.backingBytes() + self.namespace_bytes;
        const frames = self.receive_arena_bytes + constants.GOSSIP_MAX_SIZE;
        const buffers = self.sessions * self.session_buffer_bytes;
        return .{
            .retained_bytes = self.payload_bytes,
            .page_count = self.payload_bytes / storage.page_bytes,
            .message_entries = self.payload_entries,
            .validation_capacity = self.validations,
            .data_descriptors_per_peer = delivery.per_peer_limit,
            .data_descriptors_reserved_per_peer = delivery.per_peer_reserve,
            .page_bytes = storage.page_bytes,
            .frame_bytes = frames,
            .compression_bytes = constants.GOSSIP_MAX_SIZE,
            .peer_buffer_bytes = buffers,
            .metadata_bytes = metadata,
            .total_bytes = metadata + self.payload_bytes + frames + constants.GOSSIP_MAX_SIZE + buffers,
        };
    }
};
