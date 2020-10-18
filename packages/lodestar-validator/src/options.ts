import {IApiClient} from "./api";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ISlashingProtection} from "./slashingProtection";

export interface IValidatorOptions {
  slashingProtection: ISlashingProtection;
  config: IBeaconConfig;
  api: IApiClient | string;
  keypairs: Keypair[];
  logger: ILogger;
  graffiti?: string;
}
