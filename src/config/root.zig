const std = @import("std");
const testing = std.testing;

pub const BeaconConfig = @import("./BeaconConfig.zig");
pub const ChainConfig = @import("./ChainConfig.zig");
pub const ForkSeq = @import("./fork_seq.zig").ForkSeq;

pub const mainnet = @import("./networks/mainnet.zig");
pub const minimal = @import("./networks/minimal.zig");
pub const gnosis = @import("./networks/gnosis.zig");
pub const chiado = @import("./networks/chiado.zig");
pub const sepolia = @import("./networks/sepolia.zig");
pub const hoodi = @import("./networks/hoodi.zig");

test {
    testing.refAllDecls(BeaconConfig);
    testing.refAllDecls(ChainConfig);
    testing.refAllDecls(ForkSeq);

    testing.refAllDecls(mainnet);
    testing.refAllDecls(minimal);
    testing.refAllDecls(gnosis);
    testing.refAllDecls(chiado);
    testing.refAllDecls(sepolia);
    testing.refAllDecls(hoodi);
}
