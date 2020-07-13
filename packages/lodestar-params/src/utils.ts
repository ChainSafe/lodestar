import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {IBeaconParams} from "./interface";
import {ContainerType, BigIntUintType, NumberUintType, BitVectorType, BitListType, Json, ByteVectorType} from "@chainsafe/ssz";

const Number64 = new NumberUintType({byteLength: 8});
const BigInt64 = new BigIntUintType({byteLength: 8});
const BigInt256 = new BigIntUintType({byteLength: 32});

const BitVector64 = new BitVectorType({length: 8});
const ByteVector32 = new ByteVectorType({length: 4});
const ByteVector256 = new ByteVectorType({length: 32});

const beaconParamsType = new ContainerType({
  fields: {
    // Misc
    MAX_COMMITTEES_PER_SLOT: Number64,
    TARGET_COMMITTEE_SIZE: Number64,
    MAX_VALIDATORS_PER_COMMITTEE: Number64,
    MIN_PER_EPOCH_CHURN_LIMIT: Number64,
    CHURN_LIMIT_QUOTIENT: Number64,
    SHUFFLE_ROUND_COUNT: Number64,
    MIN_GENESIS_TIME: Number64,
    HYSTERESIS_QUOTIENT: Number64,
    HYSTERESIS_DOWNWARD_MULTIPLIER: Number64,
    HYSTERESIS_UPWARD_MULTIPLIER: Number64,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: Number64,
    TARGET_AGGREGATORS_PER_COMMITTEE: Number64,
    RANDOM_SUBNETS_PER_VALIDATOR: Number64,
    EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION: Number64,
    SECONDS_PER_ETH1_BLOCK: Number64,

    // Deposit contract
    DEPOSIT_CONTRACT_ADDRESS: ByteVector256,

    // Gwei Values
    MIN_DEPOSIT_AMOUNT: BigInt64,
    MAX_EFFECTIVE_BALANCE: BigInt64,
    EJECTION_BALANCE: BigInt64,
    EFFECTIVE_BALANCE_INCREMENT: BigInt64,

    // Initial values
    SAFE_SLOTS_TO_UPDATE_JUSTIFIED: Number64,
    BLS_WITHDRAWAL_PREFIX: BitVector64,
    GENESIS_FORK_VERSION: ByteVector32,
    GENESIS_START_SHARD: Number64,

    // Time parameters
    GENESIS_DELAY: Number64,
    SECONDS_PER_SLOT: Number64,
    MIN_ATTESTATION_INCLUSION_DELAY: Number64,
    SLOTS_PER_EPOCH: Number64,
    MIN_SEED_LOOKAHEAD: Number64,
    MAX_SEED_LOOKAHEAD: Number64,
    EPOCHS_PER_ETH1_VOTING_PERIOD: Number64,
    ETH1_FOLLOW_DISTANCE: Number64,
    SLOTS_PER_HISTORICAL_ROOT: Number64,
    MIN_VALIDATOR_WITHDRAWABILITY_DELAY: Number64,
    SHARD_COMMITTEE_PERIOD: Number64,

    MIN_EPOCHS_TO_INACTIVITY_PENALTY: Number64,

    // State list lengths
    EPOCHS_PER_HISTORICAL_VECTOR: Number64,
    EPOCHS_PER_SLASHINGS_VECTOR: Number64,
    HISTORICAL_ROOTS_LIMIT: Number64,
    VALIDATOR_REGISTRY_LIMIT: Number64,

    // Reward and penalty quotients
    BASE_REWARD_FACTOR: Number64,
    BASE_REWARDS_PER_EPOCH: Number64,
    WHISTLEBLOWER_REWARD_QUOTIENT: Number64,
    PROPOSER_REWARD_QUOTIENT: Number64,
    INACTIVITY_PENALTY_QUOTIENT: BigInt256,
    MIN_SLASHING_PENALTY_QUOTIENT: Number64,

    // Max operations per block
    MAX_PROPOSER_SLASHINGS: Number64,
    MAX_ATTESTER_SLASHINGS: Number64,
    MAX_ATTESTATIONS: Number64,
    MAX_DEPOSITS: Number64,
    MAX_VOLUNTARY_EXITS: Number64,

    // Old and future forks
    // ALL_FORKS: IFork[];
  },
});

export function createIBeaconParams(input: Record<string, unknown>): Partial<IBeaconParams> {
  const params: Partial<IBeaconParams> = {};
  Object.entries(beaconParamsType.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  });
  return params;
}

export const schema = new Schema({
  include: [
    FAILSAFE_SCHEMA
  ],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) { return data !== null ? data : ""; }
    })
  ]
});
