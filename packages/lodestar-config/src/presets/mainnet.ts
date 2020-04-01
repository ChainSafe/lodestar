import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {types} from "@chainsafe/lodestar-types/lib/ssz/presets/mainnet";

import {IBeaconConfig}  from "../interface";

export const config: IBeaconConfig = {
  params,
  types,
};
