pub const protobuf = @import("protobuf.zig");
pub const varint = @import("varint.zig");
pub const keys = @import("keys.zig");
pub const peer_id = @import("peer_id.zig");
pub const multiaddr = @import("multiaddr.zig");
pub const signed_key = @import("signed_key.zig");
pub const multistream = @import("multistream.zig");

test {
    _ = varint;
    _ = keys;
    _ = peer_id;
    _ = multiaddr;
    _ = signed_key;
    _ = multistream;
    _ = @import("varint.zig");
    _ = @import("multistream.zig");
    _ = @import("keys.zig");
    _ = @import("peer_id.zig");
    _ = @import("multiaddr.zig");
    _ = @import("signed_key.zig");
    _ = @import("protobuf.zig");
}
