const std = @import("std");
const napi = @import("zapi:zapi").napi;
const d = @import("network").gossipsub.diagnostics;
const Value = napi.Value;
const network_js = @import("network_js.zig");

const bytes = @import("network_js.zig").bytes;
fn weights(env: napi.Env, value: anytype) !Value {
    const object = try env.createObject();
    inline for (std.meta.fields(@TypeOf(value.*))) |field| try object.setNamedProperty(field.name, try env.createDouble(@field(value, field.name)));
    return object;
}

pub fn copy(env: napi.Env, page: *const d.Page) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("observedMonoMs", try env.createBigintUint64(page.mono_ms));
    try object.setNamedProperty("observedUnixMs", try env.createBigintInt64(page.unix_s *| 1000));
    try object.setNamedProperty("nextCursor", if (page.next) |next| try env.createUint32(next) else try env.getNull());
    const topics = try env.createArrayWithLength(page.topic_count);
    for (page.topics[0..page.topic_count], 0..) |*topic, i| {
        const row = try env.createObject();
        try row.setNamedProperty("index", try env.createUint32(topic.index));
        try row.setNamedProperty("topic", try env.createStringUtf8(topic.name[0..topic.len]));
        try row.setNamedProperty("subscribed", try env.getBoolean(topic.subscribed));
        try row.setNamedProperty("weight", try env.createDouble(topic.weight));
        try row.setNamedProperty("meshDeliveryActivationMs", try env.createBigintUint64(topic.mesh_activation_ms));
        try topics.setElement(@intCast(i), row);
    }
    try object.setNamedProperty("topics", topics);
    const peers = try env.createArrayWithLength(page.peer_count);
    for (page.peers[0..page.peer_count], 0..) |*peer, i| {
        const row = try env.createObject();
        try row.setNamedProperty("identity", try network_js.peerIdValue(env, &peer.identity));
        try row.setNamedProperty("ip", try bytes(env, &peer.address));
        try row.setNamedProperty("connected", try env.getBoolean(peer.connected));
        try row.setNamedProperty("outboundReady", try env.getBoolean(peer.outbound_ready));
        try row.setNamedProperty("expireAtMs", try env.createBigintUint64(peer.retain_until));
        try row.setNamedProperty("score", try env.createDouble(peer.score));
        try row.setNamedProperty("appScore", try env.createDouble(0));
        try row.setNamedProperty("behaviourPenalty", try env.createDouble(peer.behaviour));
        try row.setNamedProperty("weights", try weights(env, &peer.weights));
        const scores = try env.createArrayWithLength(peer.topic_count);
        for (peer.topics[0..peer.topic_count], 0..) |*entry, j| {
            const stats = try env.createObject();
            try stats.setNamedProperty("index", try env.createUint32(entry.index));
            try stats.setNamedProperty("inMesh", try env.getBoolean(entry.counters.in_mesh));
            try stats.setNamedProperty("meshMember", try env.getBoolean(entry.mesh_member));
            try stats.setNamedProperty("graftTimeMs", try env.createBigintUint64(entry.counters.graft_ms));
            try stats.setNamedProperty("meshTimeMs", try env.createBigintUint64(if (entry.counters.in_mesh) page.mono_ms -| entry.counters.graft_ms else 0));
            try stats.setNamedProperty("firstMessageDeliveries", try env.createDouble(entry.counters.first_deliveries));
            try stats.setNamedProperty("meshMessageDeliveries", try env.createDouble(entry.counters.mesh_deliveries));
            try stats.setNamedProperty("meshFailurePenalty", try env.createDouble(entry.counters.mesh_failures));
            try stats.setNamedProperty("invalidMessageDeliveries", try env.createDouble(entry.counters.invalid));
            try stats.setNamedProperty("weights", try weights(env, &entry.weights));
            try scores.setElement(@intCast(j), stats);
        }
        try row.setNamedProperty("topics", scores);
        try peers.setElement(@intCast(i), row);
    }
    try object.setNamedProperty("peers", peers);
    return object;
}
