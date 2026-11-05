//! UDP address values and owned sockets for native and supplied I/O providers.

pub const Address = @import("address.zig").Address;
pub const AddressPrefix = @import("address_prefix.zig").Prefix;
pub const AddressGroup = @import("address_group.zig").Group;
pub const Sockets = @import("sockets.zig").Sockets;

test {
    _ = Address;
    _ = @import("address_group.zig");
    _ = @import("sockets.zig");
}
