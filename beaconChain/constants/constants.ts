//Lodestar Chain
//Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants
// TODO Update TBD
// TODO Explain what each constant does

  // Misc
export const SHARD_COUNT = 2 ** 10; // 1024 shards
export const TARGET_COMMITTEE_SIZE = 2 ** 8; // 256 validators
export const MIN_BALANCE = 2 ** 4; // 16 ETH
export const MAX_BALANCE_CHURN_QUOTIENT = 2 ** 5; // 32
export const GWEI_PER_ETH = 10 ** 9; // 1B Gwei/ETH
export const BEACON_CHAIN_SHARD_NUMBER = 2 ** 64 - 1;
export const BLS_WITHDRAWAL_PREFIX_BYTE = 0x00;
export const MAX_CASPER_VOTES = 2 ** 10; // 1024 votes

// Deposit contract
export const DEPOSIT_CONTRACT_ADDRESS = "TBD";
export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const MIN_DEPOSIT = 2 ** 0; // 1 ETH
export const MAX_DEPOSIT = 2 ** 5; // 32 ETH

// Initial values
export const INITIAL_FORK_VERSION = 0;
export const INITIAL_SLOT_NUMBER = 0;
export const ZERO_HASH = new ArrayBuffer(32);

// Time parameters
export const SLOT_DURATION = 6; // 6 seconds
export const MIN_ATTESTATION_INCLUSION_DELAY = 2 ** 2; // 4 slots
export const EPOCH_LENGTH = 2 ** 6; // 64 slots
export const MIN_VALIDATOR_REGISTRY_CHANGE_INTERVAL = 2 ** 8; // 256 slots
export const POW_RECEIPT_ROOT_VOTING_PERIOD = 2 ** 10; // 1024 slots
export const SHARD_PERSISTENT_COMMITTEE_CHANGE_POERIOD = 2 ** 17; // 131,072 slots
export const COLLECTIVE_PENALTY_CALCULATION_PERIOD = 2 ** 20; // 1,048,576 slots
export const ZERO_BALANCE_VALIDATOR_TTL = 2 ** 22; // 4,194,304 slots

// Reward and penalty quotients
export const BASE_REWARD_QUOTIENT = 2 ** 11; // 2048
export const WHISTLEBLOWER_REWARD_QUOTIENT = 2 ** 9; // 512
export const INCLUDER_REWARD_QUOTIENT = 2 ** 3; // 8
export const INACTIVITY_PENALTY_QUOTIENT = 2 ** 34; // 17,179,869,184

// Max operations per block
export const MAX_PROPOSER_SLASHINGS = 2 ** 4; // 16
export const MAX_CASPER_SLASHINGS = 2 ** 4; // 16
export const MAX_ATTESTATIONS = 2 ** 7; // 128
export const MAX_DEPOSITS = 2 ** 4; // 16
export const MAX_EXITS = 2 ** 4; // 16
