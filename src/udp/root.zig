//! UDP address values and owned sockets for native and supplied I/O providers.

pub const Address = @import("address.zig").Address;
pub const AddressPrefix = @import("address_prefix.zig").Prefix;
pub const SocketPair = @import("SocketPair.zig");

test {
    _ = Address;
    _ = @import("address_prefix.zig");
    _ = @import("SocketPair.zig");
}
