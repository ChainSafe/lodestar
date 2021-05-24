import {IBeaconPreset} from "../../preset";

import {phase0} from "./phase0";
import {altair} from "./altair";

// Apr 21 commit, waiting for "v1.1.0-alpha.4"
export const commit = "66e1a2858f9fbebf5e00539d1a34b78025673d37";

export const preset: IBeaconPreset = {
  ...phase0,
  ...altair,
};
