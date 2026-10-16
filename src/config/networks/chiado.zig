const std = @import("std");
const BeaconConfig = @import("../BeaconConfig.zig");
const b = @import("hex").hexToBytesComptime;
const gnosis = @import("./gnosis.zig");

pub const config = BeaconConfig.init(chain_config, genesis_validators_root);

pub const genesis_validators_root = b(32, "0x9d642dac73058fbf39c0ae41ab1e34e4d889043cb199851ded7095bc99eb4c1e");

pub const chain_config = gnosis.chain_config.merge(.{
    .CONFIG_NAME = "chiado",

    // Genesis
    .MIN_GENESIS_ACTIVE_VALIDATOR_COUNT = 6000,
    .MIN_GENESIS_TIME = 1665396000,
    .GENESIS_FORK_VERSION = b(4, "0x0000006f"),
    .GENESIS_DELAY = 300,

    // Forking
    .ALTAIR_FORK_VERSION = b(4, "0x0100006f"),
    .ALTAIR_FORK_EPOCH = 90,
    .BELLATRIX_FORK_VERSION = b(4, "0x0200006f"),
    .BELLATRIX_FORK_EPOCH = 180,
    .TERMINAL_TOTAL_DIFFICULTY = 231707791542740786049188744689299064356246512,
    .CAPELLA_FORK_VERSION = b(4, "0x0300006f"),
    .CAPELLA_FORK_EPOCH = 244224,
    .DENEB_FORK_VERSION = b(4, "0x0400006f"),
    .DENEB_FORK_EPOCH = 516608,
    .ELECTRA_FORK_VERSION = b(4, "0x0500006f"),
    .ELECTRA_FORK_EPOCH = 948224,
    .FULU_FORK_VERSION = b(4, "0x0600006f"),
    .FULU_FORK_EPOCH = 1353216,
    .GLOAS_FORK_VERSION = b(4, "0x0700006f"),
    .GLOAS_FORK_EPOCH = std.math.maxInt(u64),

    // Deposit contract
    .DEPOSIT_CHAIN_ID = 10200,
    .DEPOSIT_NETWORK_ID = 10200,
    .DEPOSIT_CONTRACT_ADDRESS = b(20, "0xb97036A26259B7147018913bD58a774cf91acf25"),
});
