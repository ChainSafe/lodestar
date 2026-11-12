const quota_config = @import("quotas.zig");

pub fn quotas(tokens: u32, period: u64) quota_config.Rates {
    const quota: quota_config.Quota = .{ .tokens = tokens, .period_ms = period };
    return .{ .protocols = @splat(quota), .blocks_pre_deneb = quota, .blobs_pre_electra = quota, .light_client_heze = quota };
}
