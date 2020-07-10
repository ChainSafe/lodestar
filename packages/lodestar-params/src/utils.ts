import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {IBeaconParams} from "./interface";
import {ContainerType, BigIntUintType, NumberUintType, BitVectorType, BitListType} from "@chainsafe/ssz";

const beaconParamsType = new ContainerType({
  fields: {
    // Misc
    MAX_COMMITTEES_PER_SLOT: new NumberUintType({ byteLength: 8 }),
    TARGET_COMMITTEE_SIZE: new NumberUintType({ byteLength: 8 }),
    MAX_VALIDATORS_PER_COMMITTEE: new NumberUintType({ byteLength: 8 }),
    MIN_PER_EPOCH_CHURN_LIMIT: new NumberUintType({ byteLength: 8 }),
    CHURN_LIMIT_QUOTIENT: new NumberUintType({ byteLength: 8 }),
    SHUFFLE_ROUND_COUNT: new NumberUintType({ byteLength: 8 }),
    MIN_GENESIS_TIME: new NumberUintType({ byteLength: 8 }),
    HYSTERESIS_QUOTIENT: new NumberUintType({ byteLength: 8 }),
    HYSTERESIS_DOWNWARD_MULTIPLIER: new NumberUintType({ byteLength: 8 }),
    HYSTERESIS_UPWARD_MULTIPLIER: new NumberUintType({ byteLength: 8 }),
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: new NumberUintType({ byteLength: 8 }),
    TARGET_AGGREGATORS_PER_COMMITTEE: new NumberUintType({ byteLength: 8 }),
    RANDOM_SUBNETS_PER_VALIDATOR: new NumberUintType({ byteLength: 8 }),
    EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION: new NumberUintType({ byteLength: 8 }),
    SECONDS_PER_ETH1_BLOCK: new NumberUintType({ byteLength: 8 }),

    // Deposit contract
    DEPOSIT_CONTRACT_ADDRESS: new BitListType({ limit: Number.MAX_SAFE_INTEGER - 1 }), // new NumberUintType({ byteLength: 32 }),

    // Gwei Values
    MIN_DEPOSIT_AMOUNT: new BigIntUintType({ byteLength: Number.MAX_SAFE_INTEGER - 1 }),
    MAX_EFFECTIVE_BALANCE: new BigIntUintType({ byteLength: 32 }),
    EJECTION_BALANCE: new BigIntUintType({ byteLength: 32 }),
    EFFECTIVE_BALANCE_INCREMENT: new BigIntUintType({ byteLength: 32 }),

    // Initial values
    SAFE_SLOTS_TO_UPDATE_JUSTIFIED: new NumberUintType({ byteLength: 8 }),
    BLS_WITHDRAWAL_PREFIX: new BitVectorType({ length: 8 }),
    GENESIS_FORK_VERSION: new BitVectorType({ length: 32 }),
    GENESIS_START_SHARD: new NumberUintType({ byteLength: 8 }),

    // Time parameters
    GENESIS_DELAY: new NumberUintType({ byteLength: 8 }),
    SECONDS_PER_SLOT: new NumberUintType({ byteLength: 8 }),
    MIN_ATTESTATION_INCLUSION_DELAY: new NumberUintType({ byteLength: 8 }),
    SLOTS_PER_EPOCH: new NumberUintType({ byteLength: 8 }),
    MIN_SEED_LOOKAHEAD: new NumberUintType({ byteLength: 8 }),
    MAX_SEED_LOOKAHEAD: new NumberUintType({ byteLength: 8 }),
    EPOCHS_PER_ETH1_VOTING_PERIOD: new NumberUintType({ byteLength: 8 }),
    ETH1_FOLLOW_DISTANCE: new NumberUintType({ byteLength: 8 }),
    SLOTS_PER_HISTORICAL_ROOT: new NumberUintType({ byteLength: 8 }),
    MIN_VALIDATOR_WITHDRAWABILITY_DELAY: new NumberUintType({ byteLength: 8 }),
    SHARD_COMMITTEE_PERIOD: new NumberUintType({ byteLength: 8 }),

    MIN_EPOCHS_TO_INACTIVITY_PENALTY: new NumberUintType({ byteLength: 8 }),

    // State list lengths
    EPOCHS_PER_HISTORICAL_VECTOR: new NumberUintType({ byteLength: 8 }),
    EPOCHS_PER_SLASHINGS_VECTOR: new NumberUintType({ byteLength: 8 }),
    HISTORICAL_ROOTS_LIMIT: new NumberUintType({ byteLength: 8 }),
    VALIDATOR_REGISTRY_LIMIT: new NumberUintType({ byteLength: 8 }),

    // Reward and penalty quotients
    BASE_REWARD_FACTOR: new NumberUintType({ byteLength: 8 }),
    BASE_REWARDS_PER_EPOCH: new NumberUintType({ byteLength: 8 }),
    WHISTLEBLOWER_REWARD_QUOTIENT: new NumberUintType({ byteLength: 8 }),
    PROPOSER_REWARD_QUOTIENT: new NumberUintType({ byteLength: 8 }),
    INACTIVITY_PENALTY_QUOTIENT: new BigIntUintType({ byteLength: 32 }),
    MIN_SLASHING_PENALTY_QUOTIENT: new NumberUintType({ byteLength: 8 }),

    // Max operations per block
    MAX_PROPOSER_SLASHINGS: new NumberUintType({ byteLength: 8 }),
    MAX_ATTESTER_SLASHINGS: new NumberUintType({ byteLength: 8 }),
    MAX_ATTESTATIONS: new NumberUintType({ byteLength: 8 }),
    MAX_DEPOSITS: new NumberUintType({ byteLength: 8 }),
    MAX_VOLUNTARY_EXITS: new NumberUintType({ byteLength: 8 }),

    // Old and future forks
    // ALL_FORKS: IFork[];
  },
});

export function createIBeaconParams(input: Record<string, any>): Partial<IBeaconParams> {
  const params: any = {}
  Object.entries(beaconParamsType.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      params[fieldName] = fieldType.fromJson(input[fieldName]);
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
