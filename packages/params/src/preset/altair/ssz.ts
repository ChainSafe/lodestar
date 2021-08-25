/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType, BigIntUintType} from "@chainsafe/ssz";

import {IAltairPreset} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});
const BigInt64 = new BigIntUintType({byteLength: 8});

export const AltairPreset = new ContainerType<IAltairPreset>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: Number64,
    INACTIVITY_PENALTY_QUOTIENT_ALTAIR: Number64,
    MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: Number64,
  },
});
