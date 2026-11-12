const std = @import("std");
const limits = @import("limits.zig");
const StreamTable = @import("StreamTable.zig");

const half = limits.streams_per_connection / 2;

test "stream table keeps local and peer claims in disjoint halves" {
    var table = StreamTable.init(.outbound);

    var claimed: usize = 0;
    while (claimed < half) : (claimed += 1) {
        const index = table.freeLocal() orelse return error.TestUnexpectedResult;
        try std.testing.expect(index < half);
        table.claimLocal(index, table.next_local_id);
    }
    try std.testing.expect(table.freeLocal() == null);

    const peer = table.claimPeer(1) orelse return error.TestUnexpectedResult;
    try std.testing.expect(peer >= half);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
    try std.testing.expectEqual(peer, table.find(1).?);
}

test "stream table fills the peer half before refusing a claim" {
    var table = StreamTable.init(.inbound);

    var claimed: u64 = 0;
    while (claimed < half) : (claimed += 1) {
        const index = table.claimPeer(claimed * 4) orelse return error.TestUnexpectedResult;
        try std.testing.expect(index >= half);
    }
    try std.testing.expectEqual(@as(u16, half), @popCount(table.pending));
    try std.testing.expect(table.claimPeer(claimed * 4) == null);
    try std.testing.expect(table.freeLocal() != null);
}

test "stream table find returns null once a cleared entry is taken" {
    var table = StreamTable.init(.outbound);

    const index = table.freeLocal() orelse return error.TestUnexpectedResult;
    table.claimLocal(index, 0);
    try std.testing.expectEqual(index, table.find(0).?);

    table.markFinSent(index);
    table.markFinReceived(index);
    try std.testing.expect(table.entries[index].fin_sent);
    try std.testing.expect(table.entries[index].fin_received);

    table.clear(index, 5);
    try std.testing.expectEqual(index, table.find(0).?);
    try std.testing.expect(!table.matches(index, 0));
    try std.testing.expect(table.freeLocal().? != index);

    const closed = table.takeClosed(index) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u64, 0), closed.id);
    try std.testing.expectEqual(@as(u64, 5), closed.reset_code.?);
    try std.testing.expect(table.find(0) == null);
    try std.testing.expect(!table.entries[index].claimed);
    try std.testing.expect(!table.entries[index].fin_sent);
    try std.testing.expect(table.takeClosed(index) == null);
}

test "stream table keeps a peer claim blocked until its close is taken" {
    var table = StreamTable.init(.inbound);

    var claimed: u64 = 0;
    while (claimed < half) : (claimed += 1) {
        _ = table.claimPeer(claimed * 4) orelse return error.TestUnexpectedResult;
    }
    const index = table.find(0) orelse return error.TestUnexpectedResult;
    table.takeOpened(index);
    table.clear(index, null);
    try std.testing.expect(table.claimPeer(4_000) == null);

    const closed = table.takeClosed(index) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u64, 0), closed.id);
    try std.testing.expect(closed.reset_code == null);
    try std.testing.expectEqual(index, table.claimPeer(4_000).?);
}

test "stream table discard drops the pending events of an entry" {
    var table = StreamTable.init(.outbound);

    const peer = table.claimPeer(1) orelse return error.TestUnexpectedResult;
    table.clear(peer, 3);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));

    table.discard(peer);
    try std.testing.expectEqual(@as(u16, 0), @popCount(table.pending));
    try std.testing.expect(table.find(1) == null);
    try std.testing.expect(table.takeClosed(peer) == null);
}

test "stream table pending never underflows across repeated clears" {
    var table = StreamTable.init(.outbound);

    const peer = table.claimPeer(1) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
    table.takeOpened(peer);
    try std.testing.expectEqual(@as(u16, 0), @popCount(table.pending));
    table.clear(peer, 7);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
    table.clear(peer, 9);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
    const closed = table.takeClosed(peer) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u64, 7), closed.reset_code.?);
    try std.testing.expectEqual(@as(u16, 0), @popCount(table.pending));

    const local = table.freeLocal() orelse return error.TestUnexpectedResult;
    table.claimLocal(local, 0);
    table.clear(local, null);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
    _ = table.takeClosed(local) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u16, 0), @popCount(table.pending));
}

test "stream table parity follows the connection direction" {
    try std.testing.expect(StreamTable.isPeerInitiated(.outbound, 1));
    try std.testing.expect(StreamTable.isPeerInitiated(.outbound, 5));
    try std.testing.expect(!StreamTable.isPeerInitiated(.outbound, 0));
    try std.testing.expect(!StreamTable.isPeerInitiated(.outbound, 4));

    try std.testing.expect(StreamTable.isPeerInitiated(.inbound, 0));
    try std.testing.expect(StreamTable.isPeerInitiated(.inbound, 4));
    try std.testing.expect(!StreamTable.isPeerInitiated(.inbound, 1));
    try std.testing.expect(!StreamTable.isPeerInitiated(.inbound, 5));
}

test "stream table local ids advance by four from the direction parity" {
    var outbound = StreamTable.init(.outbound);
    try std.testing.expectEqual(@as(u64, 0), outbound.next_local_id);
    outbound.claimLocal(outbound.freeLocal().?, 0);
    try std.testing.expectEqual(@as(u64, 4), outbound.next_local_id);
    outbound.claimLocal(outbound.freeLocal().?, 4);
    try std.testing.expectEqual(@as(u64, 8), outbound.next_local_id);

    var inbound = StreamTable.init(.inbound);
    try std.testing.expectEqual(@as(u64, 1), inbound.next_local_id);
    inbound.claimLocal(inbound.freeLocal().?, 1);
    try std.testing.expectEqual(@as(u64, 5), inbound.next_local_id);
    inbound.claimLocal(inbound.freeLocal().?, 5);
    try std.testing.expectEqual(@as(u64, 9), inbound.next_local_id);
}

test "stream table reports readiness once and folds it into an undelivered open" {
    var table = StreamTable.init(.outbound);
    const local = table.freeLocal() orelse return error.TestUnexpectedResult;
    table.claimLocal(local, 0);
    table.arm(local, 16);
    try std.testing.expectEqual(StreamTable.bit(local), table.armed);
    table.markReady(local, .{ .readable = true, .writable = true });
    try std.testing.expectEqual(@as(StreamTable.Mask, 0), table.armed);
    try std.testing.expectEqual(@as(u32, 0), table.entries[local].write_lowat);
    try std.testing.expectEqual(local, table.nextPending().?);
    const ready = table.takeReady(local);
    try std.testing.expect(ready.readable and ready.writable);
    try std.testing.expect(table.readOpen(local));
    try std.testing.expect(!table.hasPending());

    const peer = table.claimPeer(1) orelse return error.TestUnexpectedResult;
    table.markReady(peer, .{ .readable = true });
    table.takeOpened(peer);
    try std.testing.expect(!table.hasPending());
    try std.testing.expect(table.readOpen(peer));
    table.markReady(peer, .{ .readable = true });
    table.clear(peer, null);
    try std.testing.expect(!table.entries[peer].ready.readable);
    table.markReady(peer, .{ .writable = true });
    try std.testing.expect(!table.entries[peer].ready.writable);
    try std.testing.expect(table.takeClosed(peer) != null);
    try std.testing.expect(!table.hasPending());
}

test "stream table delivery resumes after the last delivered entry" {
    var table = StreamTable.init(.inbound);
    const first = table.claimPeer(0) orelse return error.TestUnexpectedResult;
    const second = table.claimPeer(4) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(first, table.nextPending().?);
    table.takeOpened(first);
    table.advanceCursor(first);
    table.clear(first, null);
    try std.testing.expectEqual(second, table.nextPending().?);
    table.takeOpened(second);
    table.advanceCursor(second);
    try std.testing.expectEqual(first, table.nextPending().?);
}

test "stream table new watermark replaces an undelivered writable edge" {
    var table = StreamTable.init(.outbound);
    table.claimLocal(0, 0);
    table.markReady(0, .{ .readable = true, .writable = true });
    table.arm(0, 4096);
    try std.testing.expect(!table.entries[0].ready.writable);
    try std.testing.expect(table.entries[0].ready.readable);
    try std.testing.expectEqual(@as(u32, 4096), table.entries[0].write_lowat);
    try std.testing.expectEqual(@as(u16, 1), @popCount(table.pending));
}

test "stream table half shutdown clears only that half's readiness" {
    var table = StreamTable.init(.outbound);
    const peer = table.claimPeer(1).?;
    table.takeOpened(peer);
    table.markReady(peer, .{ .readable = true, .writable = true });
    table.shutdownRead(peer);
    try std.testing.expect(!table.readOpen(peer));
    try std.testing.expect(!table.entries[peer].ready.readable);
    try std.testing.expect(table.entries[peer].ready.writable);
    try std.testing.expect(table.entries[peer].fin_received);
    try std.testing.expect(!table.entries[peer].fin_sent);
    table.shutdownWrite(peer);
    try std.testing.expectEqual(@as(u16, 0), @popCount(table.pending));
    try std.testing.expectEqual(@as(StreamTable.Mask, 0), table.armed);
}

test "stream table stop preserves read interest and code until acknowledgement" {
    var table = StreamTable.init(.outbound);
    table.claimLocal(0, 0);
    table.arm(0, 1024);
    table.markReady(0, .{ .readable = true });
    table.stop(0, 77);
    try std.testing.expect(table.entries[0].stopped);
    try std.testing.expectEqual(@as(u64, 77), table.entries[0].reset_code);
    try std.testing.expectEqual(@as(StreamTable.Mask, 0), table.armed);
    const ready = table.takeReady(0);
    try std.testing.expect(ready.readable and ready.writable);
    try std.testing.expect(table.readOpen(0));
    try std.testing.expect(!table.entries[0].fin_sent and !table.entries[0].fin_received);
}
