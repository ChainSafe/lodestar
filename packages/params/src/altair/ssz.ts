/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType, ByteVectorType, BigIntUintType} from "@chainsafe/ssz";

import {IAltairParams} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});
const BigInt64 = new BigIntUintType({byteLength: 8});
const ByteVector4 = new ByteVectorType({length: 4});

export const AltairParams = new ContainerType<IAltairParams>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    SYNC_PUBKEYS_PER_AGGREGATE: Number64,
    INACTIVITY_SCORE_BIAS: BigInt64,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: Number64,
    DOMAIN_SYNC_COMMITTEE: ByteVector4,
    DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF: ByteVector4,
    DOMAIN_CONTRIBUTION_AND_PROOF: ByteVector4,
    ALTAIR_FORK_VERSION: ByteVector4,
    ALTAIR_FORK_EPOCH: Number64,
    INACTIVITY_PENALTY_QUOTIENT_ALTAIR: BigInt64,
    MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: Number64,
  },
});
