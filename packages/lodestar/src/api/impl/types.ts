import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {IBeaconSync} from "../../sync/index.js";
import {INetwork} from "../../network/index.js";
import {IMetrics} from "../../metrics/index.js";

export type ApiModules = {
  config: IChainForkConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IMetrics | null;
  network: INetwork;
  sync: IBeaconSync;
};
