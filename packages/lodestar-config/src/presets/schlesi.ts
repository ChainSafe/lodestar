import {params} from "@chainsafe/lodestar-params/lib/presets/schlesi";
import {types} from "@chainsafe/lodestar-types/lib/ssz/presets/schlesi";

import {IBeaconConfig}  from "../interface";

export const config: IBeaconConfig = {
  params,
  types,
};
