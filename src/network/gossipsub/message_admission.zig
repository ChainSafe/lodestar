const std = @import("std");
const messages = @import("messages.zig");
const storage = @import("message_store.zig");
const validation = @import("validation.zig");
const topic = @import("topic.zig");
const assert = std.debug.assert;
const turn = @import("turn.zig");
const limits_mod = @import("../gossip_limits.zig");

/// A synchronous borrow on the network owner. The consumer serializes preflight,
/// replacement and commit with its own state. Only preflighted victims may be
/// retired between preflight and commit.
pub const Admission = struct {
    messages: *messages.Messages,
    context: *const messages.Context,
    source: *const messages.Source,
    topic_index: u16,
    canonical: topic.Canonical,
    maximum_compressed: usize,
    compressed: []const u8,
    event: messages.MessageEvent,
    workspace: *const turn.Workspace,
    committed: bool = false,
    refusal: messages.StorageRefusal = .processor_capacity,

    pub const Room = struct {
        available: usize,
        payload: storage.Store.Room,
        kind_pages: usize,
        kind_entries: usize,
    };

    /// Check before considering victims: replacing one's own work must not renew
    /// a source's full share.
    pub fn sourceRoom(self: *Admission) bool {
        if (!self.context.peers.canRetain(self.source.peer)) return self.refuse(.peer_retention);
        const pending = &self.messages.validation;
        const source = self.source.peer.index;
        const k = @intFromEnum(self.kind());
        if (self.context.options.payload_limits) |limits| {
            const limit = limits[k];
            const maximum = validation.Validation.chargedBytes(self.maximum_compressed);
            const bytes = limits_mod.sourceBytes(limit, maximum, storage.inline_bytes);
            if (pending.pending_per_peer_kind[source][k] >= limits_mod.sourceItems(limit) or
                validation.Validation.chargedBytes(self.compressed.len) > bytes -| pending.bytes_per_peer_kind[source][k])
                return self.refuse(.peer_validations);
        } else if (pending.pending_per_peer[source] >= @max(1, pending.entries.len / 2)) return self.refuse(.peer_validations);
        return true;
    }

    fn kind(self: *const Admission) topic.Kind {
        return self.canonical.name.kind;
    }

    pub fn charge(self: *const Admission, cost: usize) bool {
        return self.workspace.chargeWork(self.context.options, cost);
    }

    pub fn room(self: *const Admission) Room {
        const owner = self.messages;
        const k = @intFromEnum(self.kind());
        return .{
            .available = owner.validation.available_entries.len,
            .payload = owner.store.room(),
            .kind_pages = owner.store.pending_by_kind[k],
            .kind_entries = owner.store.pending_entries_by_kind[k],
        };
    }

    /// Adds the room a distinct victim would release, without changing live state.
    /// Returns the compressed bytes that retiring it must charge to the turn.
    pub fn includeVictim(self: *const Admission, resources: *Room, handle: validation.Handle) usize {
        const owner = self.messages;
        if (handle.index >= owner.validation.entries.len) return 0;
        const entry = &owner.validation.entries[handle.index];
        if (entry.generation != handle.generation or entry.state != .pending) return 0;
        resources.available += @intFromBool(entry.generation != std.math.maxInt(u64));
        const payload = owner.store.get(entry.state.pending.message).?;
        if (!payload.provisional and !payload.history) {
            resources.payload.releaseBase(payload);
            if (payload.kind == self.kind()) {
                resources.kind_pages -= storage.Store.pagesFor(payload.len);
                resources.kind_entries -= 1;
            }
        }
        return payload.len;
    }

    /// Checks the incoming payload against a preflight's room. Call `sourceRoom` first.
    pub fn fits(self: *Admission, resources: *const Room) bool {
        if (!self.context.peers.canRetain(self.source.peer)) return self.refuse(.peer_retention);
        if (self.context.options.payload_limits) |limits| {
            const limit = limits[@intFromEnum(self.kind())];
            if (resources.kind_entries >= limit.items) return self.refuse(.kind_validations);
            if (storage.Store.pagesFor(self.compressed.len) > limit.bytes / storage.page_bytes -| resources.kind_pages) return self.refuse(.kind_payload);
        }
        const owner = self.messages;
        if (resources.available == 0) return self.refuse(.validation_capacity);
        if (owner.validation.index.find(self.event.id)) |index| {
            if (owner.validation.recent[index].state == .pending) return self.refuse(.validation_capacity);
        }
        if (!owner.history.canAdmitPayload(&owner.store, self.compressed.len, resources.payload)) return self.refuse(.payload_capacity);
        return true;
    }

    fn refuse(self: *Admission, reason: messages.StorageRefusal) bool {
        self.refusal = reason;
        return false;
    }

    pub fn commit(self: *Admission) void {
        assert(!self.committed);
        const owner = self.messages;
        assert(!owner.known(self.event.id, self.event.admitted_ms));
        const fits_now = self.fits(&self.room());
        assert(fits_now);
        const payload = owner.history.admitPayload(&owner.store, self.canonical.name.kind, self.event.id, self.event.topic, self.compressed).?;
        self.event.handle = owner.validation.admit(&owner.store, self.context.peers, payload, self.source.peer, self.topic_index, self.event.admitted_ms);
        owner.validation.attribution(self.event.handle).source_eligible = self.context.overlay.inMesh(self.topic_index, self.source.session.index);
        owner.store.seal(payload);
        self.committed = true;
    }
};

test {
    _ = @import("message_admission_test.zig");
}
