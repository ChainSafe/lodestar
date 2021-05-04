import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {IBeaconSync} from "../../sync";
import {INetwork} from "../../network";
import {IEth1ForBlockProduction} from "../../eth1";

import {IBeaconApi} from "./beacon";
import {INodeApi} from "./node";
import {IValidatorApi} from "./validator";
import {IEventsApi} from "./events";
import {IDebugApi} from "./debug/interface";
import {IConfigApi} from "./config/interface";
import {ILodestarApi} from "./lodestar";
import {IMetrics} from "../../metrics";

export const enum ApiNamespace {
  BEACON = "beacon",
  VALIDATOR = "validator",
  NODE = "node",
  EVENTS = "events",
  DEBUG = "debug",
  CONFIG = "config",
  LODESTAR = "lodestar",
}

export interface IApiModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1ForBlockProduction;
  logger: ILogger;
  metrics: IMetrics | null;
  network: INetwork;
  sync: IBeaconSync;
}

export interface IApi {
  beacon: IBeaconApi;
  node: INodeApi;
  validator: IValidatorApi;
  events: IEventsApi;
  debug: IDebugApi;
  config: IConfigApi;
  lodestar: ILodestarApi;
}
