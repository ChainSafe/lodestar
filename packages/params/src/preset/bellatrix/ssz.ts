/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType} from "@chainsafe/ssz";

import {IBellatrixPreset} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});

export const BellatrixPreset = new ContainerType<IBellatrixPreset>({
  fields: {
    INACTIVITY_PENALTY_QUOTIENT_BELLATRIX: Number64,
    MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX: Number64,
    MAX_BYTES_PER_TRANSACTION: Number64,
    MAX_TRANSACTIONS_PER_PAYLOAD: Number64,
    BYTES_PER_LOGS_BLOOM: Number64,
    MAX_EXTRA_DATA_BYTES: Number64,
  },
  // Expected and container fields are the same here
  expectedCase: "notransform",
});
