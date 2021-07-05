import {IBeaconPreset} from "../../preset";

import {phase0} from "./phase0";
import {altair} from "./altair";

export const commit = "v1.1.0-alpha.7";

export const preset: IBeaconPreset = {
  ...phase0,
  ...altair,
};
