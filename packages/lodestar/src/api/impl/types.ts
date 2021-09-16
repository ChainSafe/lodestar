import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {IBeaconSync} from "../../sync";
import {INetwork} from "../../network";
import {IMetrics} from "../../metrics";

export type ApiModules = {
  config: IChainForkConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IMetrics | null;
  network: INetwork;
  sync: IBeaconSync;
};
