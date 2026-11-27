const std = @import("std");
const processor = @import("root.zig");
const gossip = @import("../gossipsub/root.zig");
const storage = @import("../gossipsub/message_store.zig");
const none = @import("../index_list.zig").none;
const assert = std.debug.assert;

pub fn admit(table: *processor.GossipProcessor, candidate: *gossip.Gossipsub.MessageAdmission, now: u64, received_at: u64, slot: u64) bool {
    const message = &candidate.event;
    if (table.closed or now >= message.deadline or table.order == std.math.maxInt(u64)) return false;
    const topic = candidate.canonical;
    const kind = topic.name.kind;
    const fork = table.fork(topic.digest) orelse {
        table.refuse(kind, .ineligible);
        return false;
    };
    const deneb = @intFromEnum(fork) >= @intFromEnum(@as(@TypeOf(fork), .deneb));
    const metadata = processor.metadata.extract(kind, fork, message.bytes);
    if (!processor.metadata.eligible(&metadata, kind, deneb, slot)) {
        table.diag.slotRefusals +|= 1;
        table.refuse(kind, .ineligible);
        return false;
    }
    if (!candidate.sourceRoom()) return false;
    if (!table.sourceRoom(message.source, kind, message.bytes.len)) {
        table.refuse(kind, .source_full);
        return false;
    }
    const victims = preflight(table, candidate) orelse return false;
    for (victims) |index| {
        const cell = &table.cells[index];
        _ = candidate.messages.cancel(candidate.context.peers, cell.handle, message.admitted_ms);
        table.cancel(cell);
        table.retire(.{ .index = @intCast(index), .generation = cell.generation });
    }
    candidate.commit();
    table.capture(message, topic, &metadata, deneb, received_at) catch unreachable;
    return true;
}

fn preflight(table: *processor.GossipProcessor, candidate: *gossip.Gossipsub.MessageAdmission) ?[]const u32 {
    const kind = candidate.canonical.name.kind;
    const k = @intFromEnum(kind);
    const limits = table.limits[k];
    const required = storage.Store.pagesFor(candidate.event.bytes.len);
    var free_cells = table.queues[k][@intFromEnum(processor.GossipProcessor.State.free)].len;
    var pages = table.store.free_pages;
    var entries = table.store.entries.len - table.store.used_entries - table.store.retired_entries;
    var used = table.used_bytes[k];
    var protocol = candidate.room();
    var count: usize = 0;
    var bytes: usize = 0;
    var cursor = table.expiry.head;
    var inspected: usize = 0;
    var processor_full = false;
    while (count <= table.victims.len) {
        processor_full = free_cells == 0 or entries == 0 or required > pages or
            table.used_items[k] - count >= limits.items or required * storage.page_bytes > limits.bytes -| used;
        if (!processor_full and candidate.fits(&protocol)) return table.victims[0..count];
        if (count == table.victims.len or !processor.limits.newestFirst(kind)) break;
        var selected: u32 = none;
        // Admission order survives dependency promotion and host delivery.
        while (cursor != none and inspected < table.cells.len) {
            if (!candidate.charge(@sizeOf(processor.GossipProcessor.Cell))) break;
            const index = cursor;
            const cell = &table.cells[index];
            cursor = cell.expiry_link.next;
            inspected += 1;
            if (cell.kind != kind or !cell.replaceable()) continue;
            selected = index;
            break;
        }
        if (selected == none) break;
        const cell = &table.cells[selected];
        const cost = cell.input.len + candidate.includeVictim(&protocol, cell.handle);
        if (cost > processor.GossipProcessor.batch_bytes -| bytes or !candidate.charge(cost)) break;
        bytes += cost;
        const payload = table.store.get(cell.input.handle.?).?;
        assert(!payload.provisional and !payload.history and payload.senders == 0);
        const released = storage.Store.pagesFor(cell.input.len);
        pages += released;
        used -= released * storage.page_bytes;
        free_cells += @intFromBool(cell.generation < std.math.maxInt(u64));
        entries += @intFromBool(payload.generation < std.math.maxInt(u64));
        table.victims[count] = selected;
        count += 1;
    }
    if (processor_full) {
        table.diag.capacityRefusals +|= 1;
        table.refuseCapacity(kind, candidate.event.bytes.len);
    }
    return null;
}
