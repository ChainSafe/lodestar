import {IBeaconPreset} from "../../preset";

import {phase0} from "./phase0";
import {altair} from "./altair";
import {bellatrix} from "./bellatrix";

export const commit = "v1.1.8";

export const preset: IBeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
};
