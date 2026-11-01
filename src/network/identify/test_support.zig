const support = @import("../quic/test_support.zig");
const Protocols = @import("../protocols.zig").Protocols;
const Engine = @import("../quic/Engine.zig");
const identify = @import("root.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const KeyPair = @import("../wire/keys.zig").KeyPair;
const control_fixture = @import("../reqresp/control_fixture.zig");
const ReqResp = @import("../reqresp/ReqResp.zig");
const policy_fixture = @import("../reqresp/policy_fixture.zig");

pub fn peerId() !PeerId {
    const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    return .fromPublicKey(&key.publicKey());
}

pub fn step(pair: *support.Pair, protocols: *Protocols, server: bool, results: []identify.Handler.Result) usize {
    const engine = if (server) &pair.server else &pair.client;
    var events: [64]Engine.Event = undefined;
    return protocols.process(engine, pair.events(engine, &events), pair.now, .{ .identify = results }).identify;
}

pub fn protocolsOptions(agent: []const u8) !Protocols.Options {
    return .{ .control_reqresp = try control_fixture.controlOptions(), .reqresp = .{ .protocols = .application, .forks = &.{}, .admission = try ReqResp.Options.Admission.defaults(&policy_fixture.config(), 16) }, .gossipsub = .{ .random_seed = 1 }, .identify = .{ .agent = agent, .inbound_max = 1, .outbound_max = 1 } };
}
