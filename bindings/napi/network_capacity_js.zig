const napi = @import("zapi:zapi").napi;
const capacity = @import("network_capacity.zig");
const decode = @import("network_js_input.zig");
const Runtime = @import("network_runtime.zig").Runtime;

pub fn attach(env: napi.Env, value: napi.Value, token: capacity.Token) !void {
    var buffer: [capacity.token_max]u8 = undefined;
    try value.setNamedProperty("capacityToken", try env.createStringUtf8(token.format(&buffer)));
}

pub fn watch(runtime: *Runtime, value: napi.Value) !bool {
    var buffer: [capacity.token_max]u8 = undefined;
    const len = try decode.text(value, &buffer);
    const token = try capacity.Token.parse(buffer[0..len]);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop or runtime.bridge.quiescent) return error.NetworkClosed;
    runtime.refreshBridgeCapacityLocked();
    return runtime.bridge.admission_capacity.watch(token);
}
