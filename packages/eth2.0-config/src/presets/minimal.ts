import * as params from "@chainsafe/eth2.0-params/lib/presets/minimal";
import {types} from "@chainsafe/eth2.0-types/lib/ssz/presets/minimal";

import {IBeaconConfig}  from "../interface";

export const config: IBeaconConfig = {
  params,
  types,
};
