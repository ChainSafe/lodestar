import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {IBeaconSync} from "../../sync";
import {INetwork} from "../../network";
import {IEth1ForBlockProduction} from "../../eth1";
import {IMetrics} from "../../metrics";

export type ApiModules = {
  config: IBeaconConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1ForBlockProduction;
  logger: ILogger;
  metrics: IMetrics | null;
  network: INetwork;
  sync: IBeaconSync;
};
