import {IBeaconPreset} from "../../preset";

import {phase0} from "./phase0";
import {altair} from "./altair";
import {merge} from "./merge";

export const commit = "v1.1.7";

export const preset: IBeaconPreset = {
  ...phase0,
  ...altair,
  ...merge,
};
