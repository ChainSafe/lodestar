import {config as minimalConfig} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {IApiClient} from "@chainsafe/lodestar-validator";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {LogLevel} from "../logger";

export interface IValidatorClientOptions {
  //hex encoded private key or path to keystore
  validatorKey: string;
  restApi: string | IApiClient;
  db: string;
  logLevel: LogLevel;
  config: IBeaconConfig;
}

const defaultConfig: IValidatorClientOptions =  {
  config: minimalConfig,
  db: "validator-db",
  logLevel: LogLevel.debug,
  restApi: "http://localhost:9545",
  validatorKey: ""
};

export default defaultConfig;