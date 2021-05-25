/* eslint-disable @typescript-eslint/naming-convention */

import {IPhase0Preset} from "./interface";
import {ContainerType, BigIntUintType, NumberUintType} from "@chainsafe/ssz";

const Number64 = new NumberUintType({byteLength: 8});
const BigInt64 = new BigIntUintType({byteLength: 8});

export const Phase0Preset = new ContainerType<IPhase0Preset>({
  fields: {
    // Misc
    MAX_COMMITTEES_PER_SLOT: Number64,
    TARGET_COMMITTEE_SIZE: Number64,
    MAX_VALIDATORS_PER_COMMITTEE: Number64,
    /*
    MIN_PER_EPOCH_CHURN_LIMIT: Number64,
    */
    SHUFFLE_ROUND_COUNT: Number64,
    /*
    CHURN_LIMIT_QUOTIENT: Number64,
    MIN_GENESIS_TIME: Number64,
    */
    HYSTERESIS_QUOTIENT: Number64,
    HYSTERESIS_DOWNWARD_MULTIPLIER: Number64,
    HYSTERESIS_UPWARD_MULTIPLIER: Number64,
    /*
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: Number64,
    */

    // Fork choice
    SAFE_SLOTS_TO_UPDATE_JUSTIFIED: Number64,

    /*
    // Validator
    ETH1_FOLLOW_DISTANCE: Number64,
    TARGET_AGGREGATORS_PER_COMMITTEE: Number64,
    RANDOM_SUBNETS_PER_VALIDATOR: Number64,
    EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION: Number64,
    SECONDS_PER_ETH1_BLOCK: Number64,

    // Deposit contract
    DEPOSIT_CHAIN_ID: Number64,
    DEPOSIT_NETWORK_ID: Number64,
    DEPOSIT_CONTRACT_ADDRESS: ByteVector20,
    */

    // Gwei Values
    MIN_DEPOSIT_AMOUNT: BigInt64,
    MAX_EFFECTIVE_BALANCE: BigInt64,
    EJECTION_BALANCE: BigInt64,
    EFFECTIVE_BALANCE_INCREMENT: BigInt64,

    /*
    // Initial values
    GENESIS_FORK_VERSION: ByteVector4,
    BLS_WITHDRAWAL_PREFIX: ByteVector1,

    // Time parameters
    GENESIS_DELAY: Number64,
    SECONDS_PER_SLOT: Number64,
    */
    MIN_ATTESTATION_INCLUSION_DELAY: Number64,
    SLOTS_PER_EPOCH: Number64,
    MIN_SEED_LOOKAHEAD: Number64,
    MAX_SEED_LOOKAHEAD: Number64,
    EPOCHS_PER_ETH1_VOTING_PERIOD: Number64,
    SLOTS_PER_HISTORICAL_ROOT: Number64,
    /*
    MIN_VALIDATOR_WITHDRAWABILITY_DELAY: Number64,
    SHARD_COMMITTEE_PERIOD: Number64,
    */
    MIN_EPOCHS_TO_INACTIVITY_PENALTY: Number64,

    // State vector lengths
    EPOCHS_PER_HISTORICAL_VECTOR: Number64,
    EPOCHS_PER_SLASHINGS_VECTOR: Number64,
    HISTORICAL_ROOTS_LIMIT: Number64,
    VALIDATOR_REGISTRY_LIMIT: Number64,

    // Reward and penalty quotients
    BASE_REWARD_FACTOR: Number64,
    WHISTLEBLOWER_REWARD_QUOTIENT: Number64,
    PROPOSER_REWARD_QUOTIENT: Number64,
    INACTIVITY_PENALTY_QUOTIENT: BigInt64,
    MIN_SLASHING_PENALTY_QUOTIENT: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER: Number64,

    // Max operations per block
    MAX_PROPOSER_SLASHINGS: Number64,
    MAX_ATTESTER_SLASHINGS: Number64,
    MAX_ATTESTATIONS: Number64,
    MAX_DEPOSITS: Number64,
    MAX_VOLUNTARY_EXITS: Number64,
  },
});
