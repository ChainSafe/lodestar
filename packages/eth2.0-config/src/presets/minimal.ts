import * as params from "@chainsafe/eth2.0-params/lib/presets/minimal";
import {types} from "@chainsafe/eth2.0-ssz-types/lib/presets/minimal";

import {IBeaconConfig}  from "../interface";

export const config: IBeaconConfig = {
  params,
  types,
};
