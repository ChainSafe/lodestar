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
    SHUFFLE_ROUND_COUNT: Number64,
    HYSTERESIS_QUOTIENT: Number64,
    HYSTERESIS_DOWNWARD_MULTIPLIER: Number64,
    HYSTERESIS_UPWARD_MULTIPLIER: Number64,

    // Fork choice
    SAFE_SLOTS_TO_UPDATE_JUSTIFIED: Number64,

    // Gwei Values
    MIN_DEPOSIT_AMOUNT: BigInt64,
    MAX_EFFECTIVE_BALANCE: Number64,
    EFFECTIVE_BALANCE_INCREMENT: Number64,

    // Time parameters
    MIN_ATTESTATION_INCLUSION_DELAY: Number64,
    SLOTS_PER_EPOCH: Number64,
    MIN_SEED_LOOKAHEAD: Number64,
    MAX_SEED_LOOKAHEAD: Number64,
    EPOCHS_PER_ETH1_VOTING_PERIOD: Number64,
    SLOTS_PER_HISTORICAL_ROOT: Number64,
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
    INACTIVITY_PENALTY_QUOTIENT: Number64,
    MIN_SLASHING_PENALTY_QUOTIENT: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER: Number64,

    // Max operations per block
    MAX_PROPOSER_SLASHINGS: Number64,
    MAX_ATTESTER_SLASHINGS: Number64,
    MAX_ATTESTATIONS: Number64,
    MAX_DEPOSITS: Number64,
    MAX_VOLUNTARY_EXITS: Number64,
  },
  // Expected and container fields are the same here
  expectedCase: "notransform",
});
