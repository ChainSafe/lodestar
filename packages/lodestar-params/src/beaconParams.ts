/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType} from "@chainsafe/ssz";

import {IBeaconParams} from "./interface";
import {Phase0Params} from "./phase0";
import {LightclientParams} from "./lightclient";
import {Phase1Params} from "./phase1";

export const BeaconParams = new ContainerType<IBeaconParams>({
  fields: {
    ...Phase0Params.fields,
    ...LightclientParams.fields,
    ...Phase1Params.fields,
  },
});
