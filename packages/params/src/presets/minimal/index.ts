import {createIBeaconParams} from "../../utils";
import {IBeaconParams} from "../../interface";

import {phase0Json} from "./phase0";
import {altairJson} from "./altair";

// Apr 21 commit, waiting for "v1.1.0-alpha.4"
export const commit = "66e1a2858f9fbebf5e00539d1a34b78025673d37";

export const params = createIBeaconParams({
  ...phase0Json,
  ...altairJson,
}) as IBeaconParams;
