const std = @import("std");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const r = @import("network_runtime.zig");
const Runtime = r.Runtime;
const g = @import("network_gossip.zig");
const incoming = @import("network_incoming.zig");
const projection = @import("network_peer_projection.zig");
const publications = @import("network_publications.zig");
const commands = @import("network_commands.zig");
const requests = @import("network_requests.zig");
const Promise = @import("network_promise.zig");
const exchange_mod = @import("network_exchange.zig");
const Selection = exchange_mod.Selection;
const Outcome = exchange_mod.Outcome;
const bytes = network_js.bytes;
const network_incoming_js = @import("network_incoming_js.zig");
const network_js = @import("network_js.zig");
const network_publication_js = @import("network_publication_js.zig");
const network_command_js = @import("network_command_js.zig");
const network_request_js = @import("network_request_js.zig");
const network_gossip_js = @import("network_gossip_js.zig");

/// The N-API side of an exchange: the result's JS values.
pub const Host = struct {
    env: napi.Env,
    runtime: *Runtime,

    pub const Result = Value;

    pub fn settlePublication(self: *Host, token: publications.Token) !void {
        try network_publication_js.settle(self.env, self.runtime.bridge.publications.?.get(token).?);
    }
    pub fn settleCommand(self: *Host, token: commands.Token) !void {
        try network_command_js.settle(self.env, self.runtime, token);
    }
    pub fn settleRequest(self: *Host, completion: requests.Completion) !void {
        try network_request_js.settle(self.env, self.runtime, completion);
    }
    pub fn settleIncoming(self: *Host, completion: incoming.Completion) !void {
        try network_incoming_js.settle(self.env, self.runtime, completion);
    }
    pub fn settleClose(self: *Host, promise: *Promise) !void {
        const value = try self.env.createObject();
        try value.setNamedProperty("reason", try self.env.createStringUtf8(@tagName(self.runtime.bridge.reason)));
        if (self.runtime.bridge.reason == .failed) {
            const failure = try network_js.settled(self.env, network_js.errorValue(self.env, @errorName(self.runtime.bridge.terminal_error.?)));
            try value.setNamedProperty("error", failure);
        }
        try promise.settle(self.env, .resolve, value);
    }
    pub fn build(self: *Host, selection: *exchange_mod.Selection) !Value {
        return try buildResult(self.env, self.runtime, selection);
    }
    pub fn finish(self: *Host, output: Value, outcome: exchange_mod.Outcome) !Value {
        try schedule(self.env, output, outcome);
        return output;
    }

    /// An exception that clears means the bridge broke its contract. One that will not clear means JavaScript cannot
    /// run, as does a pending-exception status with none pending, which N-API returns for cannot_run_js to this
    /// module version.
    pub fn classify(self: *Host, err: anyerror) exchange_mod.Failure {
        if (err == error.Closing or err == error.CannotRunJS) return .stopped;
        const pending = self.env.isExceptionPending() catch return .stopped;
        if (!pending) return if (err == error.PendingException) .stopped else .contract;
        _ = self.env.getAndClearLastException() catch return .stopped;
        return .contract;
    }
    pub fn terminate(_: *Host, err: anyerror) noreturn {
        std.debug.panic("native network bridge: {s}", .{@errorName(err)});
    }
};

fn schedule(env: napi.Env, result: Value, outcome: Outcome) !void {
    try result.setNamedProperty("needsAnotherExchange", try env.getBoolean(outcome.needs_another_exchange));
}

/// Builds one bounded delivery, including an empty one while only completions progress.
fn buildResult(env: napi.Env, runtime: *Runtime, selection: *Selection) !Value {
    const result = try env.createObject();
    try result.setNamedProperty("identity", if (selection.identity) |*value| try network_command_js.identity(env, value) else try env.getNull());
    try result.setNamedProperty("capacityChanged", try env.getBoolean(selection.admission_capacity_changed));
    const peers = try env.createArrayWithLength(selection.peer_count);
    for (selection.peers[0..selection.peer_count], 0..) |*entry, i| try peers.setElement(@intCast(i), try projection.observation(env, entry));
    try result.setNamedProperty("peers", peers);
    const serving = try env.createArrayWithLength(selection.serving_count);
    for (selection.serving[0..selection.serving_count], 0..) |token, i| {
        const cell = &runtime.bridge.incoming.?.cells[token.index];
        try serving.setElement(@intCast(i), try network_incoming_js.descriptorValue(runtime, token, cell));
    }
    try result.setNamedProperty("serving", serving);
    const checks = try env.createArrayWithLength(selection.checks.len);
    for (selection.checks.tokens[0..selection.checks.len], selection.views[0..selection.checks.len], 0..) |token, *view, i| {
        const check = try env.createObject();
        const reference = try network_js.handle(env, token.index, token.generation);
        try check.setNamedProperty("handle", reference);
        try check.setNamedProperty("kind", try env.createStringUtf8(@tagName(view.kind)));
        try check.setNamedProperty("payloadPresent", try env.getBoolean(view.payload_present));
        try check.setNamedProperty("parentBlockHash", if (view.parent_hash) |*hash| try bytes(env, hash) else try env.getNull());
        try check.setNamedProperty("root", try bytes(env, &view.root));
        try check.setNamedProperty("slot", try env.createBigintUint64(view.slot));
        try check.setNamedProperty("peerId", try network_js.peerIdValue(env, &view.identity));
        try check.setNamedProperty("topic", try env.createStringUtf8(view.topic[0..view.topic_len]));
        try checks.setElement(@intCast(i), check);
    }
    try result.setNamedProperty("checks", checks);
    try result.setNamedProperty("gossip", if (selection.gossip) |*batch| try jobs(env, runtime, batch) else try env.getNull());
    return result;
}

fn jobs(env: napi.Env, runtime: *Runtime, batch: *const g.Batch) !Value {
    const table = &runtime.bridge.gossip.?;
    const messages = try env.createArrayWithLength(batch.len);
    for (batch.tokens[0..batch.len], 0..) |token, i| {
        try messages.setElement(@intCast(i), try network_gossip_js.descriptor(runtime, token, &table.cells[token.index]));
    }
    const result = try env.createObject();
    try result.setNamedProperty("messages", messages);
    const list = try env.createArrayWithLength(batch.job_count);
    for (batch.jobs[0..batch.job_count], 0..) |job, i| {
        const value = try env.createObject();
        try value.setNamedProperty("kind", try env.createStringUtf8(@tagName(job.kind)));
        try value.setNamedProperty("start", try env.createUint32(@intCast(job.start)));
        try value.setNamedProperty("length", try env.createUint32(@intCast(job.len)));
        try value.setNamedProperty("grouped", try env.getBoolean(job.grouped));
        try list.setElement(@intCast(i), value);
    }
    try result.setNamedProperty("jobs", list);
    return result;
}

test {
    _ = @import("network_exchange_js_test.zig");
}
