import {canonicalOptions} from "../../../util";

import * as api from "./api";
import * as dev from "./dev";
import {IDevArgs} from "./dev";
import * as chain from "./chain";
import * as eth1 from "./eth1";
import * as logger from "./logger";
import * as metrics from "./metrics";
import * as network from "./network";
import {paramsOptions} from "./params";
import {IGlobalArgs} from "../../../options";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

export const devRunOptions = canonicalOptions({
  ...dev,
  ...api,
  ...chain,
  ...eth1,
  ...logger,
  ...metrics,
  ...network,
  ...paramsOptions,
});

export type IDevOptions = IGlobalArgs & IDevArgs & Partial<IBeaconNodeOptions>;
