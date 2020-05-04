import {ChainOptions} from "../chain/options";
import {DatabaseOptions} from "../db/options";
import {Eth1Options} from "../eth1/options";
import {NetworkOptions} from "../network/options";
import {SyncOptions} from "../sync/options";
import {BeaconLoggerOptions} from "./loggerOptions";
import {MetricsOptions} from "../metrics/options";
import {IConfigurationModule} from "../util/config";
import {ApiOptions} from "../api/options";

export const BeaconNodeOptions: IConfigurationModule = {
  name: "config",
  fields: [
    ChainOptions,
    DatabaseOptions,
    // PublicApiOptions,
    Eth1Options,
    NetworkOptions,
    ApiOptions,
    SyncOptions,
    BeaconLoggerOptions,
    MetricsOptions,
  ]
};
