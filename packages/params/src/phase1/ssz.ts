/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ListType, NumberUintType, ByteVectorType, BigIntUintType} from "@chainsafe/ssz";
import {IPhase1Params} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});
const ByteVector4 = new ByteVectorType({length: 4});

export const Phase1Params = new ContainerType<IPhase1Params>({
  fields: {
    PHASE_1_FORK_VERSION: ByteVector4,
    PHASE_1_FORK_SLOT: Number64,
    INITIAL_ACTIVE_SHARDS: Number64,

    MAX_SHARDS: Number64,
    LIGHT_CLIENT_COMMITTEE_SIZE: Number64,
    GASPRICE_ADJUSTMENT_COEFFICIENT: Number64,
    MAX_SHARD_BLOCK_SIZE: Number64,
    TARGET_SHARD_BLOCK_SIZE: Number64,
    SHARD_BLOCK_OFFSETS: new ListType({
      elementType: Number64,
      limit: 100,
    }),
    MAX_SHARD_BLOCKS_PER_ATTESTATION: Number64,
    BYTES_PER_CUSTODY_CHUNK: Number64,
    CUSTODY_RESPONSE_DEPTH: Number64,
    MAX_GASPRICE: Number64,
    MIN_GASPRICE: Number64,
    ONLINE_PERIOD: Number64,
    LIGHT_CLIENT_COMMITTEE_PERIOD: Number64,
    MAX_CUSTODY_CHUNK_CHALLENGE_RECORDS: Number64,
    DOMAIN_SHARD_PROPOSAL: ByteVector4,
    DOMAIN_SHARD_COMMITTEE: ByteVector4,
    DOMAIN_LIGHT_CLIENT: ByteVector4,
    DOMAIN_CUSTODY_BIT_SLASHING: ByteVector4,
    DOMAIN_LIGHT_SELECTION_PROOF: ByteVector4,
    DOMAIN_LIGHT_AGGREGATE_AND_PROOF: ByteVector4,

    RANDAO_PENALTY_EPOCHS: Number64,
    EARLY_DERIVED_SECRET_PENALTY_MAX_FUTURE_EPOCHS: Number64,
    EPOCHS_PER_CUSTODY_PERIOD: Number64,
    CUSTODY_PERIOD_TO_RANDAO_PADDING: Number64,
    MAX_CHUNK_CHALLENGE_DELAY: Number64,

    CUSTODY_PRIME: new BigIntUintType({byteLength: 8}),
    CUSTODY_SECRETS: Number64,
    BYTES_PER_CUSTODY_ATOM: Number64,
    CUSTODY_PROBABILITY_EXPONENT: Number64,
    MAX_CUSTODY_KEY_REVEALS: Number64,
    MAX_EARLY_DERIVED_SECRET_REVEALS: Number64,
    MAX_CUSTODY_CHUNK_CHALLENGES: Number64,
    MAX_CUSTODY_CHUNK_CHALLENGE_RESP: Number64,
    MAX_CUSTODY_SLASHINGS: Number64,
    EARLY_DERIVED_SECRET_REVEAL_SLOT_REWARD_MULTIPLE: Number64,
    MINOR_REWARD_QUOTIENT: Number64,
  },
});
