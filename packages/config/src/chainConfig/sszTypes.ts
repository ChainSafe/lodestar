/* eslint-disable @typescript-eslint/naming-convention */
import {ByteVectorType, ContainerType} from "@chainsafe/ssz";
import {ssz, StringType} from "@chainsafe/lodestar-types";
import {IChainConfig} from "./types";

const ByteVector20 = new ByteVectorType({
  length: 20,
});

export const ChainConfig = new ContainerType<IChainConfig>({
  fields: {
    PRESET_BASE: new StringType(),

    // Transition
    TERMINAL_TOTAL_DIFFICULTY: ssz.Uint256,
    TERMINAL_BLOCK_HASH: ssz.Root,
    TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: ssz.Number64,

    // Genesis
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: ssz.Number64,
    MIN_GENESIS_TIME: ssz.Number64,
    GENESIS_FORK_VERSION: ssz.Version,
    GENESIS_DELAY: ssz.Number64,

    // Forking
    // Altair
    ALTAIR_FORK_VERSION: ssz.Version,
    ALTAIR_FORK_EPOCH: ssz.Number64,
    // Bellatrix
    BELLATRIX_FORK_VERSION: ssz.Version,
    BELLATRIX_FORK_EPOCH: ssz.Number64,
    // Sharding
    SHARDING_FORK_VERSION: ssz.Version,
    SHARDING_FORK_EPOCH: ssz.Number64,

    // Time parameters
    SECONDS_PER_SLOT: ssz.Number64,
    SECONDS_PER_ETH1_BLOCK: ssz.Number64,
    MIN_VALIDATOR_WITHDRAWABILITY_DELAY: ssz.Number64,
    SHARD_COMMITTEE_PERIOD: ssz.Number64,
    ETH1_FOLLOW_DISTANCE: ssz.Number64,

    // Validator cycle
    INACTIVITY_SCORE_BIAS: ssz.Number64,
    INACTIVITY_SCORE_RECOVERY_RATE: ssz.Number64,
    EJECTION_BALANCE: ssz.Number64,
    MIN_PER_EPOCH_CHURN_LIMIT: ssz.Number64,
    CHURN_LIMIT_QUOTIENT: ssz.Number64,
    PROPOSER_SCORE_BOOST: ssz.Number64,

    // Deposit contract
    DEPOSIT_CHAIN_ID: ssz.Number64,
    DEPOSIT_NETWORK_ID: ssz.Number64,
    DEPOSIT_CONTRACT_ADDRESS: ByteVector20,
  },
  // Expected and container fields are the same here
  expectedCase: "notransform",
});
