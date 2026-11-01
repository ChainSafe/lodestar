const p = @import("request_policy.zig");
const c = @import("constants");
const preset = @import("preset");

pub fn config() p.Config {
    return .{
        .deneb_start_slot = 0,
        .blocks_pre_deneb = c.MAX_REQUEST_BLOCKS,
        .blocks_deneb = c.MAX_REQUEST_BLOCKS_DENEB,
        .blob_identifiers_deneb = 768,
        .blob_identifiers_electra = 1152,
        .number_of_columns = preset.NUMBER_OF_COLUMNS,
        .column_chunks = preset.MAX_REQUEST_DATA_COLUMN_SIDECARS,
        .blob_schedule = &.{ .{ .start_slot = 0, .max_blobs = 6 }, .{ .start_slot = 100, .max_blobs = 9 } },
    };
}
