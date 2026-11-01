const n = @import("network");
const r = @import("network_runtime.zig");
const Runtime = r.Runtime;
const application_cfg = @import("network_application_config.zig");
const requests = @import("network_requests.zig");
const incoming = @import("network_incoming.zig");
const publications = @import("network_publications.zig");
const gossip = @import("network_gossip.zig");
const projection = @import("network_peer_projection.zig");
const diagnostics = @import("network_diagnostics.zig");
const network_metrics = @import("network_metrics.zig");

/// The runtime owns each installed allocation, including on partial initialization failure.
pub fn initialize(runtime: *Runtime, app: *const application_cfg.Config) !void {
    const resolved = &runtime.owner.?.resolved;
    runtime.peer_capacity = resolved.core.peers.capacity;
    const limits = resolved.core.protocols.reqresp;
    const request_capacity: usize = limits.outbound_max;
    const incoming_capacity: usize = limits.serving_max;
    const gossip_options = &resolved.core.protocols.gossipsub;
    const chain = &runtime.owner.?.config.chain;
    const processor_options = try n.gossip_processor.GossipProcessor.Options.resolve(runtime.owner.?.config.processor_limits, runtime.owner.?.config.execution_limits, gossip_options.topic_policy, chain.forks[0..chain.boundary_count], gossip_options.random_seed.?);
    const gossip_backing = gossip.Table.backingBytes(&processor_options);
    const resident_topics = try n.gossipsub.topic_policy.validate(gossip_options.topic_policy);
    const metrics_capacity = n.metrics.textCapacity(chain.topics[0..chain.boundary_count]);
    const publication_capacity: usize = publications.capacity_max;
    const bridge = publication_capacity * @sizeOf(publications.Cell) + metrics_capacity + gossip_backing + incoming_capacity * @sizeOf(incoming.Cell) + request_capacity * @sizeOf(requests.Cell) + @sizeOf(Runtime) + @sizeOf(r.Owner) - @sizeOf(n.NetworkCore) + diagnostics.Buffer.bytes(runtime.peer_capacity, resident_topics) + @sizeOf(projection.Lane);
    if (bridge > app.resources.bridgeBudgetBytes) return error.NetworkBridgeBudgetExceeded;
    runtime.metrics = try network_metrics.Export.init(metrics_capacity);
    runtime.bridge.requests = try requests.Table.init(r.allocator, request_capacity, &runtime.bridge.payload_budget);
    runtime.bridge.payload_budget.limit = app.resources.bridgeBudgetBytes - bridge;
    var response_max: usize = 0;
    var request_max: usize = 0;
    for (0..n.reqresp.Protocol.count) |i| {
        const protocol: n.reqresp.Protocol = @enumFromInt(i);
        if (!limits.protocols.contains(protocol)) continue;
        response_max = @max(response_max, protocol.info().response_max);
        request_max = @max(request_max, protocol.info().request_max);
    }
    // Keep one serving response, two local RPCs, and two urgent publications independently admissible.
    try runtime.bridge.payload_budget.protect(response_max + 2 * request_max * incoming_capacity, 2 * (request_max + 2 * response_max), 2 * gossip.payload_max);
    const clock = &runtime.owner.?.config.clock.config;
    var publication_wait_ms = clock.slot_duration_ms;
    for (clock.transitions()) |transition| publication_wait_ms = @min(publication_wait_ms, transition.new_duration_ms);
    runtime.bridge.publications = try publications.Table.init(r.allocator, publication_capacity, &runtime.bridge.payload_budget, publication_wait_ms);
    runtime.bridge.incoming = try incoming.Table.init(r.allocator, incoming_capacity, &runtime.bridge.payload_budget);
    runtime.bridge.gossip = try gossip.Table.init(r.allocator, processor_options);
    runtime.bridge.diagnostics = try diagnostics.Buffer.create(r.allocator, runtime.peer_capacity, resident_topics);
    runtime.bridge.peer_updates = try r.allocator.create(projection.Lane);
    runtime.bridge.peer_updates.?.* = .{};
}
