import {createIBeaconParams} from "../../utils";
import {IBeaconParams} from "../../interface";

import {phase0Json} from "./phase0";
import {altairJson} from "./altair";

export const commit = "v1.1.0-alpha.3";

export const params = createIBeaconParams({
  ...phase0Json,
  ...altairJson,
}) as IBeaconParams;
