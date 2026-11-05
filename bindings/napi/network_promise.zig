//! One-shot Promise ownership on the JavaScript thread. References can be deleted during environment cleanup;
//! napi_deferred has no disposal operation and cannot be settled once JavaScript stops.
const std = @import("std");
const napi = @import("zapi:zapi").napi;
const Promise = @This();

resolvers: ?napi.Ref = null,

pub fn init(self: *Promise, env: napi.Env) !napi.Value {
    std.debug.assert(self.resolvers == null);
    const constructor = try (try env.getGlobal()).getNamedProperty("Promise");
    const factory = try constructor.getNamedProperty("withResolvers");
    const resolvers = try env.callFunction(factory, constructor, .{});
    const promise = try resolvers.getNamedProperty("promise");
    self.resolvers = try napi.Ref.create(env.env, resolvers, 1);
    return promise;
}

pub fn deinit(self: *Promise) void {
    if (self.resolvers) |ref| ref.delete() catch unreachable;
    self.resolvers = null;
}

pub fn settle(self: *Promise, env: napi.Env, comptime outcome: enum { resolve, reject }, value: napi.Value) !void {
    const ref = self.resolvers.?;
    self.resolvers = null;
    defer ref.delete() catch unreachable;
    const resolvers = try ref.getValue();
    const function = try resolvers.getNamedProperty(@tagName(outcome));
    _ = try env.callFunction(function, try env.getUndefined(), .{value});
}
