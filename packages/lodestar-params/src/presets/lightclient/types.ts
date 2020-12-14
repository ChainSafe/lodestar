/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType, NumberUintType, ByteVectorType} from "@chainsafe/ssz";

const Number64 = new NumberUintType({byteLength: 8});
const ByteVector4 = new ByteVectorType({length: 4});

export type LightclientParams = {
  SYNC_COMMITTEE_SIZE: number;
  SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: number;
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: number;
  DOMAIN_SYNC_COMMITTEE: Buffer;
};

export const LightclientParamsSSZ = new ContainerType<LightclientParams>({
  fields: {
    SYNC_COMMITTEE_SIZE: Number64,
    SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: Number64,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: Number64,
    DOMAIN_SYNC_COMMITTEE: ByteVector4,
  },
});
