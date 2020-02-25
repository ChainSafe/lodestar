import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {IApiClient} from "@chainsafe/lodestar-validator";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LogLevel} from  "@chainsafe/lodestar-utils/lib/logger";

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