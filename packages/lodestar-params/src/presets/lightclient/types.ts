/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType} from "@chainsafe/ssz";

const Number64 = new NumberUintType({byteLength: 8});

export type LightClientParams = {
  SYNC_COMMITTEE_SIZE: number;
  SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: number;
};

export const LightClientParamsSSZ = new ContainerType<LightClientParams>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: Number64,
  },
});
