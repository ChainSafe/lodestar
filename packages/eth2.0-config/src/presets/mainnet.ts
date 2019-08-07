import * as params from "@chainsafe/eth2.0-params/lib/presets/mainnet";
import {types} from "@chainsafe/eth2.0-ssz-types/lib/presets/mainnet";

import {IBeaconConfig}  from "../interface";

export const config: IBeaconConfig = {
  params,
  types,
};
