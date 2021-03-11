/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType, ByteVectorType, BigIntUintType} from "@chainsafe/ssz";

import {ILightclientParams} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});
const BigInt64 = new BigIntUintType({byteLength: 8});
const ByteVector4 = new ByteVectorType({length: 4});

export const LightclientParams = new ContainerType<ILightclientParams>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: Number64,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: Number64,
    DOMAIN_SYNC_COMMITTEE: ByteVector4,
    LIGHTCLIENT_PATCH_FORK_VERSION: ByteVector4,
    LIGHTCLIENT_PATCH_FORK_SLOT: Number64,
    HF1_INACTIVITY_PENALTY_QUOTIENT: BigInt64,
    HF1_MIN_SLASHING_PENALTY_QUOTIENT: Number64,
    HF1_PROPORTIONAL_SLASHING_MULTIPLIER: Number64,
  },
});
