import {IChainForkConfig} from "@lodestar/config";
import {ILogger} from "@lodestar/utils";

import {INetwork} from "@lodestar/beacon-node/network";
import {IMetrics} from "@lodestar/beacon-node/metrics";
import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {IBeaconSync} from "../../sync/index.js";

/**
 * PR ensure API follows spec required to include the isOptimstic boolean in many routes.
 * To keep the scope of the PR manageable, the PR will only add the flag with proper logic on
 * critical routes. Else it is left as a temporary always false to be implemented next.
 */
export const IS_OPTIMISTIC_TEMP = false;

export type ApiModules = {
  config: IChainForkConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IMetrics | null;
  network: INetwork;
  sync: IBeaconSync;
};
