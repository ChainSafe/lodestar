import {IApiClient} from "./api";
import {IKeypair} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ISlashingProtection} from "./slashingProtection";

export interface IValidatorOptions {
  slashingProtection: ISlashingProtection;
  config: IBeaconConfig;
  api: IApiClient | string;
  keypairs: IKeypair[];
  logger: ILogger;
  graffiti?: string;
}
