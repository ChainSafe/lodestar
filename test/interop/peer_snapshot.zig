const std = @import("std");
const network = @import("network");
const control = @import("peer_control.zig");
const Peer = @import("network_peer.zig").Peer;

pub fn emit(peer: *Peer, id: u32) !void {
    const reqresp = peer.protocols.reqresp.pendingCounts();
    const control_reqresp = peer.protocols.control_reqresp.pendingCounts();
    const gossip = peer.protocols.gossipsub.resourceSnapshot();
    var streams: usize = 0;
    for (peer.transport.engine.registry.activeIndices()) |index| {
        for (peer.transport.engine.registry.slots[index].table.entries) |entry| {
            if (entry.claimed) streams += 1;
        }
    }
    var negotiations: usize = 0;
    for (peer.protocols.router.negotiator.entries) |entry| {
        if (entry.state != .free) negotiations += 1;
    }
    var has_inbound = false;
    var outbound_version: ?[]const u8 = null;
    for (peer.protocols.gossipsub.sessions.rows) |entry| {
        if (!entry.active) continue;
        if (entry.in_stream != null) has_inbound = true;
        if (entry.outbound == .live) outbound_version = @tagName(entry.outbound.live.version);
    }
    try control.emit(peer.allocator, .{
        .id = id,
        .ok = true,
        .connections = peer.transport.engine.registry.activeIndices().len,
        .streams = streams,
        .heldFin = peer.held_finish != null,
        .finishCalls = peer.finish_calls,
        .negotiations = negotiations,
        .hasInboundStream = has_inbound,
        .outboundVersion = outbound_version,
        .steps = peer.steps,
        .connectionIndex = if (peer.conn) |conn| @as(?u16, conn.index) else null,
        .connectionDirection = if (peer.conn) |conn| if (peer.transport.engine.direction(conn)) |direction| @as(?[]const u8, @tagName(direction)) else null else null,
        .connectionGeneration = if (peer.conn) |conn| @as(?u32, conn.generation) else null,
        .malformedRpcs = peer.protocols.gossipsub.counters.malformed_rpcs,
        .gossipPeers = gossip.admitted_peers,
        .remoteSubscriptions = gossip.remote_subscriptions,
        .meshMembers = gossip.mesh_members,
        .reqrespOutbound = @as(usize, reqresp.outbound) + control_reqresp.outbound,
        .reqrespInbound = @as(usize, reqresp.inbound) + control_reqresp.inbound,
        .gossipDescriptors = gossip.queued_descriptors,
        .gossipQueuedBytes = gossip.queued_bytes,
        .heldFrames = gossip.held_frames,
        .storeEntries = gossip.store_entries,
        .storePages = gossip.store_pages,
        .pendingValidations = gossip.pending_validations,
        .promises = gossip.promises,
        .emitted = peer.emitted,
    });
}

pub fn ids(a: std.mem.Allocator, id: u32) !void {
    const topic = "/eth2/01000000/beacon_block/ssz_snappy";
    const other = "/eth2/01000000/voluntary_exit/ssz_snappy";
    const phase0 = network.gossipsub.topic.MessageIdPolicy{ .phase0_digest = .{ 1, 0, 0, 0 } };
    try control.emit(a, .{
        .id = id,
        .ok = true,
        .phase0Other = std.fmt.bytesToHex(network.gossipsub.topic.validMessageId(other, "hello", phase0), .lower),
        .phase0 = std.fmt.bytesToHex(network.gossipsub.topic.validMessageId(topic, "hello", phase0), .lower),
        .altair = std.fmt.bytesToHex(network.gossipsub.topic.validMessageId(topic, "hello", .{}), .lower),
        .invalid = std.fmt.bytesToHex(network.gossipsub.topic.invalidMessageId(topic, &.{0xff}, .{}), .lower),
        .other = std.fmt.bytesToHex(network.gossipsub.topic.validMessageId(other, "hello", .{}), .lower),
    });
}
