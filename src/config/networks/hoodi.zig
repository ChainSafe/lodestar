const std = @import("std");
const ChainConfig = @import("../ChainConfig.zig");
const BeaconConfig = @import("../BeaconConfig.zig");
const b = @import("hex").hexToBytesComptime;
const mainnet = @import("./mainnet.zig");

pub const config = BeaconConfig.init(chain_config, genesis_validators_root);

pub const genesis_validators_root = b(32, "0x212f13fc4df078b6cb7db228f1c8307566dcecf900867401a92023d7ba99cb5f");

pub const chain_config = mainnet.chain_config.merge(.{
    .CONFIG_NAME = "hoodi",

    // Genesis
    .MIN_GENESIS_TIME = 1742212800,
    .GENESIS_FORK_VERSION = b(4, "0x10000910"),
    .GENESIS_DELAY = 600,

    // Forking
    .ALTAIR_FORK_VERSION = b(4, "0x20000910"),
    .ALTAIR_FORK_EPOCH = 0,
    .BELLATRIX_FORK_VERSION = b(4, "0x30000910"),
    .BELLATRIX_FORK_EPOCH = 0,
    .TERMINAL_TOTAL_DIFFICULTY = 0,
    .CAPELLA_FORK_VERSION = b(4, "0x40000910"),
    .CAPELLA_FORK_EPOCH = 0,
    .DENEB_FORK_VERSION = b(4, "0x50000910"),
    .DENEB_FORK_EPOCH = 0,
    .ELECTRA_FORK_VERSION = b(4, "0x60000910"),
    .ELECTRA_FORK_EPOCH = 2048,
    .FULU_FORK_VERSION = b(4, "0x70000910"),
    .FULU_FORK_EPOCH = 50688,
    .GLOAS_FORK_VERSION = b(4, "0x80000910"),
    .GLOAS_FORK_EPOCH = std.math.maxInt(u64),
    .HEZE_FORK_VERSION = b(4, "0x90000910"),

    // Time parameters
    .SECONDS_PER_ETH1_BLOCK = 12,

    // Deposit contract
    .DEPOSIT_CHAIN_ID = 560048,
    .DEPOSIT_NETWORK_ID = 560048,

    // Blob Scheduling
    .BLOB_SCHEDULE = &[_]ChainConfig.BlobScheduleEntry{
        .{
            .EPOCH = 52480,
            .MAX_BLOBS_PER_BLOCK = 15,
        },
        .{
            .EPOCH = 54016,
            .MAX_BLOBS_PER_BLOCK = 21,
        },
    },
});
