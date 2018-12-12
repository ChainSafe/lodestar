"use strict";
// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants
// TODO Update TBD
// TODO Explain what each constant does
Object.defineProperty(exports, "__esModule", { value: true });
// Misc
exports.SHARD_COUNT = Math.pow(2, 10); // 1024 shards
exports.TARGET_COMMITTEE_SIZE = Math.pow(2, 8); // 256 validators
exports.MIN_BALANCE = Math.pow(2, 4); // 16 ETH
exports.MAX_BALANCE_CHURN_QUOTIENT = Math.pow(2, 5); // 32
exports.GWEI_PER_ETH = Math.pow(10, 9); // 1B Gwei/ETH
exports.BEACON_CHAIN_SHARD_NUMBER = Math.pow(2, 64) - 1;
exports.BLS_WITHDRAWAL_PREFIX_BYTE = 0x00;
exports.MAX_CASPER_VOTES = Math.pow(2, 10); // 1024 votes
// Deposit contract
exports.DEPOSIT_CONTRACT_ADDRESS = "TBD";
exports.DEPOSIT_CONTRACT_TREE_DEPTH = Math.pow(2, 5); // 32
exports.MIN_DEPOSIT = Math.pow(2, 0); // 1 ETH
exports.MAX_DEPOSIT = Math.pow(2, 5); // 32 ETH
// Initial values
exports.INITIAL_FORK_VERSION = 0;
exports.INITIAL_SLOT_NUMBER = 0;
exports.ZERO_HASH = new ArrayBuffer(32);
// Time parameters
exports.SLOT_DURATION = 6; // 6 seconds
exports.MIN_ATTESTATION_INCLUSION_DELAY = Math.pow(2, 2); // 4 slots
exports.EPOCH_LENGTH = Math.pow(2, 6); // 64 slots
exports.MIN_VALIDATOR_REGISTRY_CHANGE_INTERVAL = Math.pow(2, 8); // 256 slots
exports.POW_RECEIPT_ROOT_VOTING_PERIOD = Math.pow(2, 10); // 1024 slots
exports.SHARD_PERSISTENT_COMMITTEE_CHANGE_POERIOD = Math.pow(2, 17); // 131,072 slots
exports.COLLECTIVE_PENALTY_CALCULATION_PERIOD = Math.pow(2, 20); // 1,048,576 slots
exports.ZERO_BALANCE_VALIDATOR_TTL = Math.pow(2, 22); // 4,194,304 slots
// Reward and penalty quotients
exports.BASE_REWARD_QUOTIENT = Math.pow(2, 11); // 2048
exports.WHISTLEBLOWER_REWARD_QUOTIENT = Math.pow(2, 9); // 512
exports.INCLUDER_REWARD_QUOTIENT = Math.pow(2, 3); // 8
exports.INACTIVITY_PENALTY_QUOTIENT = Math.pow(2, 34); // 17,179,869,184
// Max operations per block
exports.MAX_PROPOSER_SLASHINGS = Math.pow(2, 4); // 16
exports.MAX_CASPER_SLASHINGS = Math.pow(2, 4); // 16
exports.MAX_ATTESTATIONS = Math.pow(2, 7); // 128
exports.MAX_DEPOSITS = Math.pow(2, 4); // 16
exports.MAX_EXITS = Math.pow(2, 4); // 16
//# sourceMappingURL=constants.js.map