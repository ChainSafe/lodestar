const rr = @import("ReqResp.zig");
const policy_fixture = @import("policy_fixture.zig");

pub fn applicationOptions() !rr.Options {
    return .{ .protocols = .application, .outbound_max = 2, .serving_max = 2, .forks = &.{}, .admission = try rr.Options.Admission.defaults(&policy_fixture.config(), 1) };
}

pub fn controlOptions() !rr.Options {
    var result: rr.Options = .{ .protocols = .control, .routes = .control, .report_non_completion = false, .outbound_max = 2, .serving_max = 0, .serving_per_source_max = 0, .inbound_per_connection_max = 8, .forks = &.{}, .admission = try rr.Options.Admission.defaults(&policy_fixture.config(), 2) };
    result.admission.scope = .peer;
    return result;
}
