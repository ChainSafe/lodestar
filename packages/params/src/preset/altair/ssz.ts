/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType} from "@chainsafe/ssz";

import {IAltairPreset} from "./interface";

const Number64 = new NumberUintType({byteLength: 8});

export const AltairPreset = new ContainerType<IAltairPreset>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: Number64,
    INACTIVITY_PENALTY_QUOTIENT_ALTAIR: Number64,
    MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: Number64,
    PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: Number64,
  },
  // Expected and container fields are the same here
  expectedCase: "notransform",
});
