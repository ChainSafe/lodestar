const std = @import("std");
const ChainConfig = @import("../ChainConfig.zig");
const BeaconConfig = @import("../BeaconConfig.zig");
const b = @import("hex").hexToBytesComptime;
const mainnet = @import("./mainnet.zig");

pub const config = BeaconConfig.init(chain_config, genesis_validators_root);

pub const genesis_validators_root = b(32, "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078");

pub const chain_config = mainnet.chain_config.merge(.{
    .CONFIG_NAME = "sepolia",

    // Genesis
    .MIN_GENESIS_ACTIVE_VALIDATOR_COUNT = 1300,
    .MIN_GENESIS_TIME = 1655647200,
    .GENESIS_FORK_VERSION = b(4, "0x90000069"),
    .GENESIS_DELAY = 86400,

    // Forking
    .ALTAIR_FORK_VERSION = b(4, "0x90000070"),
    .ALTAIR_FORK_EPOCH = 50,
    .BELLATRIX_FORK_VERSION = b(4, "0x90000071"),
    .BELLATRIX_FORK_EPOCH = 100,
    .TERMINAL_TOTAL_DIFFICULTY = 17000000000000000,
    .CAPELLA_FORK_VERSION = b(4, "0x90000072"),
    .CAPELLA_FORK_EPOCH = 56832,
    .DENEB_FORK_VERSION = b(4, "0x90000073"),
    .DENEB_FORK_EPOCH = 132608,
    .ELECTRA_FORK_VERSION = b(4, "0x90000074"),
    .ELECTRA_FORK_EPOCH = 222464,
    .FULU_FORK_VERSION = b(4, "0x90000075"),
    .FULU_FORK_EPOCH = 272640,
    .GLOAS_FORK_VERSION = b(4, "0x90000076"),
    .GLOAS_FORK_EPOCH = std.math.maxInt(u64),
    .HEZE_FORK_VERSION = b(4, "0x90000077"),

    // Deposit contract
    .DEPOSIT_CHAIN_ID = 11155111,
    .DEPOSIT_NETWORK_ID = 11155111,
    .DEPOSIT_CONTRACT_ADDRESS = b(20, "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"),

    // Blob Scheduling
    .BLOB_SCHEDULE = &[_]ChainConfig.BlobScheduleEntry{
        .{
            .EPOCH = 274176,
            .MAX_BLOBS_PER_BLOCK = 15,
        },
        .{
            .EPOCH = 275712,
            .MAX_BLOBS_PER_BLOCK = 21,
        },
    },
});
