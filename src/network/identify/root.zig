pub const codec = @import("codec.zig");

pub const Handler = @import("handler.zig").Handler;
pub const Metadata = codec.Metadata;
pub const Local = codec.Local;

test {
    _ = @import("codec.zig");
    _ = @import("handler.zig");
}
