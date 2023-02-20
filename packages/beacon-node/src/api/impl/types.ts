import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";

import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {IBeaconSync} from "../../sync/index.js";
import {INetwork} from "../../network/index.js";
import {Metrics} from "../../metrics/index.js";

export type ApiModules = {
  config: ChainForkConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: Logger;
  metrics: Metrics | null;
  network: INetwork;
  sync: IBeaconSync;
};
