import {IApiClient} from "./api";
import {ISecretKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ISlashingProtection} from "./slashingProtection";

export interface IValidatorOptions {
  slashingProtection: ISlashingProtection;
  config: IBeaconConfig;
  api: IApiClient | string;
  secretKeys: ISecretKey[];
  logger: ILogger;
  graffiti?: string;
}
