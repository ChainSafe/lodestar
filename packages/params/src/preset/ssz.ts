/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType} from "@chainsafe/ssz";

import {IBeaconPreset} from "./interface";
import {Phase0Preset} from "./phase0";
import {AltairPreset} from "./altair";
import {BellatrixPreset} from "./bellatrix";

export const BeaconPreset = new ContainerType<IBeaconPreset>({
  fields: {
    ...Phase0Preset.fields,
    ...AltairPreset.fields,
    ...BellatrixPreset.fields,
  },
  expectedCase: "notransform",
});
