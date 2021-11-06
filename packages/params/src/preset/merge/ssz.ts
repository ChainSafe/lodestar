/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType} from "@chainsafe/ssz";

import {IMergePreset} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});

export const MergePreset = new ContainerType<IMergePreset>({
  fields: {
    INACTIVITY_PENALTY_QUOTIENT_MERGE: Number64,
    MIN_SLASHING_PENALTY_QUOTIENT_MERGE: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER_MERGE: Number64,
    MAX_BYTES_PER_TRANSACTION: Number64,
    MAX_TRANSACTIONS_PER_PAYLOAD: Number64,
    BYTES_PER_LOGS_BLOOM: Number64,
    MAX_EXTRA_DATA_BYTES: Number64,
  },
  // Expected and container fields are the same here
  expectedCase: "notransform",
});
