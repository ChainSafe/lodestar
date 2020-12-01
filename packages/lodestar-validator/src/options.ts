import {IApiClient} from "./api";
import {SecretKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ISlashingProtection} from "./slashingProtection";

export interface IValidatorOptions {
  slashingProtection: ISlashingProtection;
  config: IBeaconConfig;
  api: IApiClient | string;
  secretKeys: SecretKey[];
  logger: ILogger;
  graffiti?: string;
}
