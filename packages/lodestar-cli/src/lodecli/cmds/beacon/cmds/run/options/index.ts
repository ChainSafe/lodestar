import {canonicalOptions} from "../../../../../util";

import * as api from "./api";
import * as chain from "./chain";
import * as eth1 from "./eth1";
import * as logger from "./logger";
import * as metrics from "./metrics";
import * as network from "./network";
import {paramsOptions} from "./params";

export const beaconRunOptions = canonicalOptions({
  ...api,
  ...chain,
  ...eth1,
  ...logger,
  ...metrics,
  ...network,
  ...paramsOptions,
});
