import {canonicalOptions} from "../../../util";

import * as api from "./api";
import * as dev from "./dev";
import {IDevArgs} from "./dev";
import * as chain from "./chain";
import * as eth1 from "./eth1";
import * as logger from "./logger";
import * as metrics from "./metrics";
import * as network from "./network";
import * as sync from "./sync";
import * as validator from "./validator";
import {IGlobalArgs} from "../../../options";
import {IChainArgs} from "./chain";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {IValidatorArgs} from "./validator";

export const devRunOptions = canonicalOptions({
  ...dev,
  ...api,
  ...chain,
  ...eth1,
  ...logger,
  ...metrics,
  ...network,
  ...sync,
  ...validator,
});

export type IDevOptions = IGlobalArgs & IValidatorArgs & IChainArgs & IDevArgs & Partial<IBeaconNodeOptions>;
